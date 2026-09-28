// Telegram-бот проекта: диалог по проекту (AiGate / DeepSeek 4) + приём заявок с сайта.
// Запуск: node scripts/bot/bot.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG, ROOT_DIR } from '../seo-agent/config.mjs';
import { chat } from '../seo-agent/lib/aigate.mjs';
import { getUpdates, sendMessage, sendChatAction, getMe, setMyCommands, escapeHtml } from './telegram.mjs';
import { maxSendToAllChats, maxReady } from './max.mjs';
import { SYSTEM_PROMPT } from './project-context.mjs';
import { PROFILE } from '../../site.profile.mjs';
// Согласование предложений. Сетевой режим: если PROFILE.bot.network задан (массив {dir,tag}),
// один бот обслуживает предложения нескольких сайтов сети (один @bot на все площадки),
// иначе — только свой сайт. Читаем/пишем proposals.json напрямую по путям сайтов.
function networkSites() {
  const own = { dir: ROOT_DIR, tag: PROFILE.bot?.networkTag || '' };
  const extra = Array.isArray(PROFILE.bot?.network) ? PROFILE.bot.network : [];
  return [own, ...extra];
}
const propsPath = (dir) => join(dir, 'scripts/seo-agent/data/agent/proposals.json');
const readProps = (dir) => { try { return JSON.parse(readFileSync(propsPath(dir), 'utf-8')); } catch { return []; } };
function allPendingProposals() {
  const out = [];
  for (const s of networkSites()) for (const p of readProps(s.dir)) if (p.status === 'pending') out.push({ ...p, _dir: s.dir, _tag: s.tag });
  return out;
}
function decideProposal(id, status) {
  for (const s of networkSites()) {
    const list = readProps(s.dir);
    const p = list.find((x) => String(x.id) === String(id));
    if (p) { p.status = status; p.decidedAt = new Date().toISOString(); writeFileSync(propsPath(s.dir), JSON.stringify(list, null, 2), 'utf-8'); return { ...p, _dir: s.dir, _tag: s.tag }; }
  }
  return null;
}

// Заявки сайта. reg.ru блокирует исходящие в Telegram, поэтому форма пишет заявки только в
// api/leads.log на хостинге; lead-forward.py на VPS (cron */5) тянет его по FTP, досылает НОВЫЕ в
// Telegram и зеркалит весь лог в data/leads.log. Здесь читаем этот локальный кэш и показываем
// последние заявки по команде — раньше их можно было увидеть ТОЛЬКО в потоке уведомлений, вызвать
// «все заявки» в боте было нельзя. Формат строки: `<ISO-ts>\t<json>` (ts опционален).
const leadsPath = (dir) => join(dir, 'data/leads.log');
function readLeads(dir) {
  const out = [];
  try {
    for (const line of readFileSync(leadsPath(dir), 'utf-8').split(/\r?\n/)) {
      const s = line.trim(); if (!s) continue;
      const tab = s.indexOf('\t');
      const ts = tab > 0 ? s.slice(0, tab) : '';
      try { out.push({ ts, lead: JSON.parse(tab > 0 ? s.slice(tab + 1) : s) }); } catch {}
    }
  } catch {}
  return out;
}
function allLeads() {
  const out = [];
  for (const s of networkSites()) for (const r of readLeads(s.dir)) out.push({ ...r, _tag: s.tag });
  return out;
}
function fmtLead({ ts, lead, _tag }) {
  const tag = _tag ? `[${escapeHtml(_tag)}] ` : '';
  const when = ts ? ` · <i>${escapeHtml(ts.slice(0, 16).replace('T', ' '))}</i>` : '';
  const L = [`${tag}🟢 <b>${escapeHtml(lead.name || lead.contact || 'Заявка')}</b>${when}`];
  if (lead.contact && lead.name) L.push(`  📞 ${escapeHtml(lead.contact)}`);
  if (lead.service) L.push(`  🩺 ${escapeHtml(String(lead.service))}`);
  if (lead.time) L.push(`  ⏰ ${escapeHtml(String(lead.time))}`);
  if (lead.message) L.push(`  💬 ${escapeHtml(String(lead.message).slice(0, 220))}`);
  if (lead.budget) L.push(`  💰 ${escapeHtml(String(lead.budget))}`);
  if (lead.source) L.push(`  📍 ${escapeHtml(String(lead.source))}`);
  if (lead.page) L.push(`  🔗 ${escapeHtml(String(lead.page))}`);
  return L.join('\n');
}

const DIALOG_MODEL = CONFIG.aigate.dialogModel;
const HISTORY_LIMIT = 16; // последних реплик в контексте
const history = new Map(); // chatId -> [{role, content}]

function pushHistory(chatId, role, content) {
  const h = history.get(chatId) ?? [];
  h.push({ role, content });
  while (h.length > HISTORY_LIMIT) h.shift();
  history.set(chatId, h);
}

const HELP = [
  `Я ассистент проекта <b>${escapeHtml(PROFILE.bot.projectName)}</b>.`,
  'Спрашивай что угодно по сайту и продвижению — отвечаю через DeepSeek 4.',
  '',
  'Команды:',
  '/leads — последние заявки с сайта (можно /leads 30)',
  '/proposals — предложения агента, ждущие согласования',
  '/approve &lt;id&gt; — одобрить · /reject &lt;id&gt; — отклонить',
  '/reset — очистить историю диалога',
  '/help — эта справка',
].join('\n');

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  if (!text) return;

  // Только владелец проекта — иначе любой нашедший бота бесплатно гоняет платный LLM и историю диалога.
  if (String(chatId) !== String(CONFIG.telegram.chatId)) {
    console.warn(`[bot] отклонён чужой chatId=${chatId}`);
    return;
  }

  if (text === '/start') {
    history.delete(chatId);
    await sendMessage(`Привет! ${HELP}`, { chatId });
    return;
  }
  if (text === '/help') return void (await sendMessage(HELP, { chatId }));
  if (text === '/reset') {
    history.delete(chatId);
    return void (await sendMessage('История очищена. О чём поговорим?', { chatId }));
  }

  // Все заявки сайта из локального кэша (data/leads.log, зеркало lead-forward.py). `/leads [N]`.
  if (text === '/leads' || text === '/zayavki' || text.startsWith('/leads ') || text.startsWith('/zayavki ')) {
    const n = Math.min(Math.max(parseInt(text.split(/\s+/)[1], 10) || 15, 1), 50);
    const all = allLeads();
    if (!all.length) {
      return void (await sendMessage('Заявок пока нет (либо форвардер ещё не подтянул лог с хостинга — обновляется каждые 5 минут).', { chatId }));
    }
    const recent = all.slice(-n).reverse();
    // бьём на сообщения ≤3500 символов (лимит Telegram 4096)
    let buf = `📋 <b>Заявки</b> — всего ${all.length}, показываю последние ${recent.length}:`;
    for (const b of recent.map(fmtLead)) {
      if ((buf + '\n\n' + b).length > 3500) { await sendMessage(buf, { chatId }); buf = ''; }
      buf = buf ? buf + '\n\n' + b : b;
    }
    if (buf) await sendMessage(buf, { chatId });
    return;
  }

  // Согласование предложений автономного агента (risk=approve): список / одобрить / отклонить.
  if (text === '/proposals') {
    const ps = allPendingProposals();
    if (!ps.length) return void (await sendMessage('Предложений на согласование нет.', { chatId }));
    const lines = ps.map((p) => {
      const first = Object.values(p.args || {})[0];
      const tag = p._tag ? `[${escapeHtml(p._tag)}] ` : '';
      return `• ${tag}<code>${escapeHtml(String(p.id))}</code> — <b>${escapeHtml(p.type)}</b>: ${escapeHtml(String(first || '').slice(0, 90))}\n  /approve ${p.id} · /reject ${p.id}`;
    });
    return void (await sendMessage('🤖 <b>Ожидают согласования:</b>\n\n' + lines.join('\n\n'), { chatId }));
  }
  if (text.startsWith('/approve') || text.startsWith('/reject')) {
    const [cmd, id] = text.split(/\s+/);
    if (!id) return void (await sendMessage(`Укажи id, напр. <code>${escapeHtml(cmd)} 26090201003666</code>. Список: /proposals`, { chatId }));
    const p = decideProposal(id, cmd === '/approve' ? 'approved' : 'rejected');
    if (!p) return void (await sendMessage(`Не нашёл предложение <code>${escapeHtml(id)}</code> (возможно, уже решено). Актуальные: /proposals`, { chatId }));
    const tag = p._tag ? `[${escapeHtml(p._tag)}] ` : '';
    const summary = Object.entries(p.args || {}).map(([k, v]) => `• ${escapeHtml(k)}: ${escapeHtml(String(v).slice(0, 220))}`).join('\n');
    if (cmd === '/approve') {
      // new_section → авто-генерация хаб/пилларной страницы в фоне В ПАПКЕ САЙТА-ИСТОЧНИКА
      // (generate-hub.mjs если есть, иначе fallback generate-one.mjs).
      if (p.type === 'new_section') {
        const dir = p._dir || ROOT_DIR;
        const section = String(p.args?.section || Object.values(p.args || {})[0] || '').trim();
        const hub = join(dir, 'scripts/seo-agent/generate-hub.mjs');
        const one = join(dir, 'scripts/seo-agent/generate-one.mjs');
        let script = null, arg = section;
        if (existsSync(hub)) { script = hub; arg = section; }
        else if (existsSync(one)) { script = one; arg = section.split(/\s[—–-]\s|:/)[0].trim() || section; }
        if (script && arg) {
          spawn(process.execPath, [script, arg, String(chatId)], { cwd: dir, detached: true, stdio: 'ignore' }).unref();
          return void (await sendMessage(
            `✅ <b>Одобрено:</b> ${tag}new_section\n${summary}\n\n🚀 Запустил автогенерацию хаб-страницы: генерация → фактчек → публикация → сборка → деплой → переиндексация. Пришлю ссылку по готовности (обычно 2–4 мин).`,
            { chatId }
          ));
        }
      }
      return void (await sendMessage(
        `✅ <b>Одобрено:</b> ${tag}${escapeHtml(p.type)}\n${summary}\n\n` +
        `Записал в очередь работ. Это правка сайта/контента — approve-действия агент не публикует сам, их реализует человек (я/команда). Отслеживание — /proposals.`,
        { chatId }
      ));
    }
    return void (await sendMessage(`❌ <b>Отклонено:</b> ${tag}${escapeHtml(p.type)}. Больше это предлагать не буду.`, { chatId }));
  }

  await sendChatAction(chatId, 'typing');
  pushHistory(chatId, 'user', text);
  try {
    const reply = await chat(
      [{ role: 'system', content: SYSTEM_PROMPT }, ...(history.get(chatId) ?? [])],
      { tier: 'dialog', temperature: 0.6, maxTokens: 1200, costCategory: 'dialog' }
    );
    pushHistory(chatId, 'assistant', reply);
    await sendMessage(escapeHtml(reply), { chatId, parseMode: 'HTML' });
  } catch (e) {
    await sendMessage(`⚠️ Ошибка модели: ${escapeHtml(e.message)}`, { chatId });
  }
}

// ── Long polling ─────────────────────────────────────
async function pollLoop() {
  let offset;
  // пропустить накопившиеся апдейты, чтобы не отвечать на старое
  try {
    const init = await getUpdates(undefined, 0);
    if (init.length) offset = init[init.length - 1].update_id + 1;
  } catch {}
  console.log('[bot] поллинг запущен');
  for (;;) {
    try {
      const updates = await getUpdates(offset, 30);
      for (const u of updates) {
        offset = u.update_id + 1;
        if (u.message) handleMessage(u.message).catch((e) => console.error('[bot] msg err', e.message));
      }
    } catch (e) {
      console.error('[bot] poll err:', e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

// ── HTTP-эндпоинт заявок с формы сайта ───────────────
function startLeadServer() {
  const port = CONFIG.telegram.leadPort;
  const server = http
    .createServer((req, res) => {
      // CORS для формы сайта
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      if (req.method === 'OPTIONS') return res.writeHead(204).end();
      if (req.method !== 'POST' || !req.url.startsWith('/api/lead')) {
        return res.writeHead(404).end('not found');
      }
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 1e5) req.destroy();
      });
      req.on('end', async () => {
        try {
          const d = JSON.parse(body || '{}');
          if (d.company) return res.writeHead(200).end('{"ok":true}'); // honeypot
          const lines = [
            `🟢 <b>Новая заявка — ${escapeHtml(PROFILE.bot.projectName)}</b>`,
            d.name && `👤 ${escapeHtml(d.name)}`,
            d.contact && `📞 ${escapeHtml(d.contact)}`,
            d.message && `💬 ${escapeHtml(d.message)}`,
            d.source && `📍 Блок: ${escapeHtml(d.source)}`,
            d.page && `🔗 Страница: ${escapeHtml(d.page)}`,
          ].filter(Boolean);
          await sendMessage(lines.join('\n'));
          if (maxReady()) {
            const plain = [
              `Новая заявка — ${PROFILE.bot.projectName}`,
              d.name && `${d.name}`,
              d.contact && `тел/контакт: ${d.contact}`,
              d.message && `${d.message}`,
              d.page && `страница: ${d.page}`,
            ].filter(Boolean).join('\n');
            maxSendToAllChats(plain).catch(() => {});
          }
          res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
        } catch (e) {
          console.error('[lead] err', e.message);
          res.writeHead(500).end('{"ok":false}');
        }
      });
    });
  server.on('error', (e) => console.error('[bot] лид-сервер не запущен (некритично, лиды идут через PHP):', e.message));
  server.listen(port, () => console.log(`[bot] лид-эндпоинт (резерв): http://localhost:${port}/api/lead`));
}

// ── Старт ────────────────────────────────────────────
const me = await getMe();
console.log(`[bot] @${me.username} запущен`);
await setMyCommands([
  { command: 'leads', description: 'Последние заявки с сайта' },
  { command: 'proposals', description: 'Предложения агента на согласование' },
  { command: 'approve', description: 'Одобрить предложение по id' },
  { command: 'reject', description: 'Отклонить предложение по id' },
  { command: 'reset', description: 'Очистить историю диалога' },
  { command: 'help', description: 'Справка по командам' },
]);
startLeadServer();
pollLoop();
