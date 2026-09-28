// Каталог инструментов автономного агента. Каждый инструмент = обёртка над существующим скриптом/lib
// ИЛИ «предложение» (escalate). Класс риска решает, делает агент сам или спрашивает человека.
//   risk 'auto'    — обратимо, безопасно, в бюджете → выполняется без спроса.
//   risk 'approve' — необратимо/наружу/новое/дорого → уходит в Telegram на /approve, ждёт человека.
// Инвариант: агент НЕ обходит гейты качества (уникальность/citability/eeat/ai-slop) и НЕ хардкодит пути —
// всё через site.profile.mjs. Реальные действия — вызов существующих скриптов ядра.
import { execSync } from 'node:child_process';
import { ROOT_DIR } from '../config.mjs';
import { logDecision, proposeAction } from './agent-journal.mjs';

const sh = (cmd, env = {}) => {
  try { return { ok: true, out: execSync(cmd, { cwd: ROOT_DIR, stdio: 'pipe', env: { ...process.env, ...env } }).toString().slice(-2000) }; }
  catch (e) { return { ok: false, out: ((e.stdout?.toString() || '') + (e.stderr?.toString() || '')).slice(-2000) }; }
};

// ── AUTO-инструменты (агент делает сам) ──────────────────────────────
// Поле `cap` — ключ возможности из capabilities.mjs; инструмент показывается агенту ТОЛЬКО если
// возможность реально доступна (не даём выбрать то, чей сервис/ключ отсутствует). null = всегда.
export const TOOLS = {
  generate_article: {
    risk: 'auto', cap: 'llm', desc: 'Сгенерировать и опубликовать 1 статью по gap-теме/запросу (живая генерация ядра).',
    args: { query: 'целевой запрос (опц., иначе агент выберет по gap+demand)' },
    run: ({ query } = {}) => sh(`node scripts/seo-agent/run.mjs`, { ONLY_GEN: '1', MAX_NEW_PAGES: '1', ...(query ? { FORCE_TOPIC: query } : {}) }),
  },
  expand_thin: {
    risk: 'auto', cap: 'llm', desc: 'Дописать тонкие страницы до нормы объёма/citability.',
    run: () => sh(`node scripts/seo-agent/expand-existing.mjs`),
  },
  rewrite_ctr: {
    risk: 'auto', cap: 'llm', desc: 'Переписать title/description у страниц с показами без кликов (рост CTR из выдачи).',
    run: () => sh(`node scripts/seo-agent/run.mjs`, { ONLY_CTR: '1' }),
  },
  refresh_stale: {
    risk: 'auto', cap: 'llm', desc: 'Освежить страницы-кандидаты на цитирование старше 30 дней (факты/год/dateModified).',
    run: () => sh(`node scripts/seo-agent/run.mjs`, { ONLY_REFRESH: '1' }),
  },
  ai_probe: {
    risk: 'auto', cap: 'llm', desc: 'Замерить AI Share of Voice (цитируют ли нас нейросети) — обратная связь.',
    run: () => sh(`node scripts/seo-agent/ai-citation-probe.mjs`),
  },
  brand_scan: {
    risk: 'auto', cap: 'semantics', desc: 'Пересчитать Brand Authority по RU-площадкам.',
    run: () => sh(`node scripts/seo-agent/brand-mentions.mjs`),
  },
  drift_check: {
    risk: 'auto', cap: null, desc: 'Проверить SEO-drift (не потерялись ли schema/canonical/страницы после деплоя).',
    run: () => sh(`node -e "import('./scripts/seo-agent/lib/drift.mjs').then(m=>console.log(m.driftReportLine(m.runDrift())))"`),
  },

  aeo_check: {
    risk: 'auto', cap: null, desc: 'AEO-аудит: цитируемость нейросетями (доступ AI-ботам, schema+автор, FAQ, свежесть, llms.txt) + список, что добить.',
    run: () => sh(`node -e "import('./scripts/seo-agent/lib/aeo.mjs').then(async m=>{const r=await m.aeoAudit();console.log(m.aeoLine(r));console.log(JSON.stringify(r.checks))})"`),
  },

  // ── APPROVE-инструменты (агент готовит предложение, человек решает) ──
  deploy_widget: {
    risk: 'approve', cap: null, desc: 'Внедрить новый виджет/элемент (калькулятор, квиз, форма, блок доверия) — код на сайт.',
    args: { what: 'что за виджет', where: 'куда', why: 'ожидаемый эффект на заявки/поведение' },
    run: (a) => proposeAction('deploy_widget', a),
  },
  redesign_block: {
    risk: 'approve', cap: null, desc: 'Изменить дизайн/структуру блока (герой, CTA, карточки) — наружу видимое.',
    args: { block: '', change: '', why: '' },
    run: (a) => proposeAction('redesign_block', a),
  },
  new_section: {
    risk: 'approve', cap: null, desc: 'Завести новый раздел сайта/тип контента (новый кластер, посадочные).',
    args: { section: '', rationale: '' },
    run: (a) => proposeAction('new_section', a),
  },
  outreach: {
    risk: 'approve', cap: null, desc: 'Внешний аутрич/PR/упоминание бренда на площадке (наружу от имени владельца).',
    args: { channel: '', message: '' },
    run: (a) => proposeAction('outreach', a),
  },
  big_spend: {
    risk: 'approve', cap: null, desc: 'Действие сверх дневного бюджета ИИ/API.',
    args: { amountUsd: 0, purpose: '' },
    run: (a) => proposeAction('big_spend', a),
  },
};

/** Санитизация аргументов: оставляем только объявленные ключи, чтобы модель не «протащила» лишнее. */
function sanitizeArgs(tool, args) {
  if (!tool.args || !args || typeof args !== 'object') return {};
  const allowed = Object.keys(tool.args);
  const clean = {}, dropped = [];
  for (const [k, v] of Object.entries(args)) { if (allowed.includes(k)) clean[k] = v; else dropped.push(k); }
  return { clean, dropped };
}

/** Выполнить инструмент с учётом класса риска. auto → run; approve → в очередь на согласование. */
export async function invokeTool(name, args, { budgetLeft = Infinity, availableCaps = null } = {}) {
  const t = TOOLS[name];
  if (!t) return { ok: false, out: `неизвестный инструмент: ${name}`, unknownTool: true };
  // возможность выключена конфигом сервера → не выполняем (защита от выбора недоступного)
  if (t.cap && availableCaps && !availableCaps.includes(t.cap)) {
    await logDecision({ action: name, status: 'skipped-nocap', tail: `нет возможности: ${t.cap}` });
    return { ok: false, out: `возможность недоступна: ${t.cap}`, noCap: true };
  }
  const { clean = {}, dropped = [] } = sanitizeArgs(t, args);
  if (t.risk === 'approve') {
    const res = await t.run(clean);
    await logDecision({ action: name, args: clean, risk: 'approve', status: 'proposed', tail: dropped.length ? `лишние args отброшены: ${dropped.join(',')}` : undefined });
    return { ok: true, escalated: true, out: `предложено человеку на согласование: ${name}`, ...res };
  }
  if (budgetLeft <= 0) { await logDecision({ action: name, args: clean, risk: 'auto', status: 'skipped-budget' }); return { ok: false, out: 'бюджет исчерпан' }; }
  const res = t.run(clean);
  await logDecision({ action: name, args: clean, risk: 'auto', status: res.ok ? 'done' : 'failed', tail: res.out?.slice(-300) });
  return res;
}

/**
 * Описание каталога для промпта планировщика.
 * @param {string[]|null} availableCaps — если задан, показываем ТОЛЬКО доступные по возможностям инструменты.
 */
export function toolCatalog(availableCaps = null) {
  return Object.entries(TOOLS)
    .filter(([, t]) => !t.cap || !availableCaps || availableCaps.includes(t.cap))
    .map(([k, t]) => `- ${k} [${t.risk}]: ${t.desc}${t.args ? ` (args: ${Object.keys(t.args).join(', ')})` : ''}`).join('\n');
}

/** Список имён инструментов, доступных под возможности (для валидации выбора планировщика). */
export function allowedToolNames(availableCaps = null) {
  return Object.entries(TOOLS).filter(([, t]) => !t.cap || !availableCaps || availableCaps.includes(t.cap)).map(([k]) => k);
}
