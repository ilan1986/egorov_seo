// АВТОНОМНЫЙ РЕЖИМ: агент сам смотрит на состояние сайта, решает что делать ради роста трафика/заявок,
// делает (auto) или предлагает человеку (approve), журналирует и учится. НЕ фикс-workflow — ReAct-цикл.
// Запуск (cron, напр. раз в день или чаще): node scripts/seo-agent/agent.mjs
// Дефолт остаётся линейным run.mjs; автономный режим — отдельная точка входа/ветка MODE=agent.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG, ROOT_DIR, readiness } from './config.mjs';
import { ask } from './lib/aigate.mjs';
import { TOOLS, invokeTool, toolCatalog, allowedToolNames } from './lib/agent-tools.mjs';
import { probeCapabilities } from './lib/capabilities.mjs';
import { goals, dailyBudgetUsd, recentJournal, logDecision, runningExperiments, pendingProposals } from './lib/agent-journal.mjs';
import { metrikaReady, metrikaToday } from './lib/metrika.mjs';
import { webmasterReady, demandGaps } from './lib/webmaster.mjs';

const DRY = process.env.AGENT_DRY === '1'; // режим наблюдения: решает, но не исполняет

const DATA = join(ROOT_DIR, 'scripts/seo-agent/data');
const readJson = (p, d) => { try { return JSON.parse(readFileSync(join(DATA, p), 'utf-8')); } catch { return d; } };

function todaySpendUsd() {
  const day = new Date().toISOString().slice(0, 10);
  const c = readJson(`costs/${day}.json`, { usd: {} });
  return Object.values(c.usd || {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

// ВОСПРИЯТИЕ: состояние сайта из данных агента + ЖИВЫЕ метрики (Метрика трафик/заявки, Вебмастер спрос).
async function perceive() {
  const st = readJson('report-state.json', {});
  const pos = st.positions || {};
  const arr = Object.entries(pos).map(([q, p]) => ({ q, p: Math.round(Number(p) * 10) / 10 })).filter((x) => Number.isFinite(x.p)).sort((a, b) => a.p - b.p);
  const sov = readJson('ai-sov.json', {}).latest || null;
  const brand = readJson('brand-authority.json', {}).latest || null;
  const spent = todaySpendUsd();

  // Живые сигналы (guarded — если не настроено, тихо пропускаем)
  let traffic = null, demand = null;
  if (metrikaReady()) { try { const m = await metrikaToday(); traffic = { visits: m.visits ?? m.visitors ?? null, pageviews: m.pageviews ?? null }; } catch {} }
  if (webmasterReady()) { try { demand = (await demandGaps({ top: 8 })).map((d) => ({ q: d.query, demand: d.demand })); } catch {} }

  return {
    positions: { top10: arr.filter((x) => x.p <= 10).length, top20: arr.filter((x) => x.p > 10 && x.p <= 20).length, tracked: arr.length, best: arr.slice(0, 6) },
    traffic_today: traffic,
    demand_gaps: demand,               // высокий спрос, где мы не в топе → кандидаты на генерацию
    ai_sov: sov?.sovPct ?? null,
    brand_authority: brand?.score ?? null,
    ai_spent_today_usd: Math.round(spent * 100) / 100,
    budget_left_usd: Math.max(0, dailyBudgetUsd() - spent),
    pending_proposals: pendingProposals().length,
    running_experiments: runningExperiments().length,
  };
}

const REASON_SYS =
  'Ты — автономный SEO/GEO-специалист сайта. Твоя ЦЕЛЬ: ежедневно растить органический трафик и число ' +
  'заявок/звонков. Ты действуешь как проактивный сотрудник: сам анализируешь состояние и решаешь, какое ОДНО ' +
  'следующее действие даст максимум к цели прямо сейчас. Не жди указаний. Соблюдай ограничения и бюджет. ' +
  'Рискованные действия (виджеты, редизайн, аутрич, крупные траты) — предлагай, их одобрит человек. ' +
  'Отвечай СТРОГО JSON: {"thought":"...", "action":"<имя из каталога|stop>", "args":{...}, "why":"обоснование по данным"}. ' +
  'action:"stop" если ценных действий в бюджете не осталось.';

function buildPrompt(state, done, { caps = null, lastError = null } = {}) {
  const names = allowedToolNames(caps);
  const user =
    `ЦЕЛИ: ${JSON.stringify(goals())}\n\n` +
    `СОСТОЯНИЕ САЙТА:\n${JSON.stringify(state, null, 1)}\n\n` +
    `ИНСТРУМЕНТЫ (выбирай action СТРОГО из этого списка имён: ${names.join(', ')}):\n${toolCatalog(caps)}\n\n` +
    (lastError ? `⚠️ ПРЕДЫДУЩИЙ ВЫБОР ОТКЛОНЁН: ${lastError}. Выбери имя ТОЛЬКО из списка выше.\n\n` : '') +
    `УЖЕ СДЕЛАНО В ЭТОМ ПРОГОНЕ: ${done.length ? done.map((d) => d.action).join(', ') : '—'}\n` +
    `ПОСЛЕДНИЕ РЕШЕНИЯ (журнал): ${JSON.stringify(recentJournal(8).map((j) => ({ a: j.action, s: j.status })))}\n\n` +
    `Выбери СЛЕДУЮЩЕЕ действие (или stop).`;
  return { system: REASON_SYS, user };
}

async function decide(state, done, opts = {}) {
  const { system, user } = buildPrompt(state, done, opts);
  // Основной путь: AI SDK tool-calling (схемный выбор, без парс-сбоев). Фолбэк: сырой JSON.
  if (process.env.AGENT_DECIDE !== 'json') {
    try {
      const { decideAiSdk } = await import('./lib/decide-aisdk.mjs');
      const r = await decideAiSdk(system, user, { caps: opts.caps });
      if (r && r.action) return r;
    } catch (e) { console.log('[agent] AI SDK decide → фолбэк на JSON:', e.message); }
  }
  let raw = await ask(system, user + '\n\nОтветь СТРОГО JSON: {"action":"<имя|stop>","args":{...},"why":"…"}.', { maxTokens: 500, temperature: 0.4 });
  let plan = parseJsonObject(raw);
  if (!plan || !plan.action) {
    try {
      raw = await ask(system + ' ВЕРНИ ТОЛЬКО JSON-объект, без markdown.',
        user + '\n\nОтветь ОДНИМ JSON-объектом {"action","args","why"}.', { maxTokens: 400, temperature: 0.2 });
      plan = parseJsonObject(raw);
    } catch {}
  }
  return plan && plan.action ? plan : { action: 'stop', why: 'не разобрал ответ планировщика', raw: raw?.slice(0, 200) };
}

// Устойчивый парсер JSON-объекта из ответа LLM: снимает ```-ограждения, ищет объект с "action".
function parseJsonObject(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(s); } catch {}
  // все кандидаты {...} от каждой { до сбалансированной }
  for (let i = s.indexOf('{'); i >= 0; i = s.indexOf('{', i + 1)) {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') { depth--; if (depth === 0) { try { const o = JSON.parse(s.slice(i, j + 1)); if (o && o.action) return o; } catch {} break; } }
    }
  }
  return null;
}

async function main() {
  if (!readiness().aigate && !CONFIG.aigate?.apiKey) { console.log('aigate не настроен — автономный режим невозможен'); return; }
  const MAX_CYCLES = Number(process.env.AGENT_MAX_CYCLES || 6);
  const done = [];

  // Зонд возможностей сервера: агенту доступны ТОЛЬКО реально поддержанные инструменты.
  const rep = await probeCapabilities().catch(() => null);
  const caps = rep ? rep.capabilities.filter((c) => c.ok).map((c) => c.key) : null;
  if (rep) console.log('[agent] возможности:', caps.join(', '));

  let state = await perceive();
  console.log(`[agent] старт${DRY ? ' (РЕЖИМ НАБЛЮДЕНИЯ — без исполнения)' : ''}. состояние:`, JSON.stringify(state));

  let lastError = null, badPicks = 0, budgetHit = false;
  for (let i = 0; i < MAX_CYCLES; i++) {
    if (state.budget_left_usd <= 0) { console.log('[agent] бюджет дня исчерпан — стоп'); budgetHit = true; break; }
    let plan;
    try { plan = await decide(state, done, { caps, lastError }); }
    catch (e) { console.log('[agent] планировщик недоступен:', e.message); break; }
    console.log(`[agent] цикл ${i + 1}: ${plan.action} — ${plan.why || ''}`);
    if (!plan.action || plan.action === 'stop') { await logDecision({ action: 'stop', why: plan.why }); break; }

    // Защита от выдуманного/недоступного инструмента: не выполняем, а ВОЗВРАЩАЕМ модели ошибку для самокоррекции.
    const allowed = allowedToolNames(caps);
    if (!TOOLS[plan.action] || !allowed.includes(plan.action)) {
      lastError = !TOOLS[plan.action]
        ? `инструмента "${plan.action}" не существует`
        : `инструмент "${plan.action}" недоступен на этом сервере (нет возможности)`;
      await logDecision({ action: plan.action, status: 'rejected', tail: lastError });
      if (++badPicks >= 3) { console.log('[agent] 3 подряд невалидных выбора — стоп'); break; } // не жечь бюджет
      continue;
    }
    lastError = null; badPicks = 0;

    if (DRY) {
      await logDecision({ action: plan.action, args: plan.args, why: plan.why, status: 'DRY-would-do' });
      done.push({ action: plan.action, why: plan.why, dry: true, risk: TOOLS[plan.action].risk });
      continue;
    }
    const res = await invokeTool(plan.action, plan.args, { budgetLeft: state.budget_left_usd, availableCaps: caps });
    done.push({ action: plan.action, why: plan.why, ok: res.ok, escalated: res.escalated });
    state = await perceive(); // пересобрать (бюджет/данные изменились)
  }

  // Отчёт человеку
  const proposals = pendingProposals();
  const lines = [
    `🤖 <b>Автономный прогон завершён</b> (${done.length} действий)`,
    ...done.map((d) => `${d.escalated ? '📨' : d.ok ? '✅' : '⚠️'} ${d.action}${d.why ? ` — ${d.why}` : ''}`),
    proposals.length ? `\n⏳ Ждут твоего решения (${proposals.length}): ${proposals.map((p) => `${p.type} <code>/approve ${p.id}</code>`).join(' · ')}` : '',
    budgetHit ? `\n💸 <b>Уперся в дневной бюджет $${dailyBudgetUsd()}</b> — работа прервана, есть что ещё сделать. Поднять бюджет на сегодня? Ответь суммой (<code>/budget +1</code>) или оставь до завтра. Решаем вместе.` : '',
  ].filter(Boolean);
  try {
    const { sendMessage } = await import('../bot/telegram.mjs');
    if (readiness().telegram) await sendMessage(lines.join('\n'));
  } catch {}
  console.log('[agent] готово:', done.length, 'действий,', proposals.length, 'на согласовании', budgetHit ? '(бюджет исчерпан — уведомил бот проекта)' : '');
}

main().catch((e) => { console.error('[agent] фатально:', e.message); process.exit(1); });
