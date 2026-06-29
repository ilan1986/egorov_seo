// Telegram-бот проекта: диалог по проекту (AiGate / DeepSeek 4) + приём заявок с сайта.
// Запуск: node scripts/bot/bot.mjs
import http from 'node:http';
import { CONFIG } from '../seo-agent/config.mjs';
import { chat } from '../seo-agent/lib/aigate.mjs';
import { getUpdates, sendMessage, sendChatAction, getMe, escapeHtml } from './telegram.mjs';
import { SYSTEM_PROMPT } from './project-context.mjs';

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
  'Я ассистент проекта <b>Рудова Налоги</b>.',
  'Спрашивай что угодно по сайту, услугам, продвижению и налогам — отвечаю через DeepSeek 4.',
  '',
  'Команды:',
  '/reset — очистить историю диалога',
  '/help — эта справка',
].join('\n');

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  if (!text) return;

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

  await sendChatAction(chatId, 'typing');
  pushHistory(chatId, 'user', text);
  try {
    const reply = await chat(
      [{ role: 'system', content: SYSTEM_PROMPT }, ...(history.get(chatId) ?? [])],
      { modelOverride: DIALOG_MODEL, temperature: 0.6, maxTokens: 1200 }
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
            '🟢 <b>Новая заявка с сайта</b>',
            d.name && `👤 ${escapeHtml(d.name)}`,
            d.contact && `📞 ${escapeHtml(d.contact)}`,
            d.message && `💬 ${escapeHtml(d.message)}`,
            d.source && `📍 Блок: ${escapeHtml(d.source)}`,
            d.page && `🔗 Страница: ${escapeHtml(d.page)}`,
          ].filter(Boolean);
          await sendMessage(lines.join('\n'));
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
startLeadServer();
pollLoop();
