// Агентный слой: LLM-планировщик приоритетов вместо жёсткого линейного run.mjs.
// НЕ ломает существующее — включается ветку `MODE=agent`, дефолт остаётся линейным.
//
// Идея: собрать снапшот состояния сайта из УЖЕ существующих функций ядра, дать его Sonnet
// с описанием доступных действий (обёрток над существующими скриптами) и бюджета — модель
// возвращает упорядоченный план с обоснованием. Исполнитель идёт по плану, каждое действие
// проходит те же гейты публикации (уникальность/объём/citability/schema). Планировщик НЕ пишет
// в файлы и не публикует напрямую — только приоритезирует.
import { ask } from './aigate.mjs';

// Каталог действий агента (обёртки над существующими скриптами/функциями ядра).
export const ACTIONS = {
  generate_new: 'Сгенерировать новую статью по gap-теме/кластеру (живая генерация run.mjs).',
  fill_demand_gap: 'Таргетная генерация под запрос с высоким DEMAND и нулём кликов (webmaster.demandGaps).',
  expand_thin: 'Дописать тонкую страницу до нормы объёма/citability (expand-existing).',
  boost_citability: 'Переписать слабые по citability секции существующей страницы (citability.mjs).',
  rewrite_ctr: 'Переписать meta title/description у страниц с показами без кликов (ctr-optimize).',
  refresh_stale: 'Обновить факты/дату у страницы-кандидата на цитирование старше 30 дней (health.mjs).',
};

/**
 * Собрать компактный снапшот состояния для планировщика.
 * Все источники — существующие функции ядра; передаются готовыми, чтобы planner не тянул зависимостей.
 * @param {object} snap — { demandGaps[], thinPages[], ctrCandidates[], positionDrops[], queueDepth, budgetUsd, aiSov }
 */
export function stateDigest(snap) {
  const n = (a) => (Array.isArray(a) ? a.length : 0);
  return {
    demand_gaps: (snap.demandGaps || []).slice(0, 8),
    thin_pages: (snap.thinPages || []).slice(0, 8),
    ctr_candidates: (snap.ctrCandidates || []).slice(0, 8),
    position_drops: (snap.positionDrops || []).slice(0, 8),
    queue_depth: snap.queueDepth ?? 0,
    budget_usd_left: snap.budgetUsd ?? null,
    ai_sov_pct: snap.aiSov ?? null,
    counts: { demand: n(snap.demandGaps), thin: n(snap.thinPages), ctr: n(snap.ctrCandidates), drops: n(snap.positionDrops) },
  };
}

/**
 * Спросить у Sonnet приоритетный план действий на прогон.
 * @returns {Promise<Array<{action,target?,why}>>}
 */
export async function planRun(snap, { maxActions = 5 } = {}) {
  const digest = stateDigest(snap);
  const actionsDoc = Object.entries(ACTIONS).map(([k, v]) => `- ${k}: ${v}`).join('\n');
  const sys = 'Ты — SEO/GEO-стратег. По состоянию сайта выбери и приоритезируй действия на сегодня, ' +
    'чтобы максимально вырасти в трафике и цитируемости нейросетями при ограниченном бюджете. ' +
    'Отвечай ТОЛЬКО валидным JSON-массивом, без пояснений вокруг.';
  const user = `Доступные действия:\n${actionsDoc}\n\n` +
    `Состояние сайта (JSON):\n${JSON.stringify(digest, null, 1)}\n\n` +
    `Верни до ${maxActions} действий, отсортированных по приоритету, в формате:\n` +
    `[{"action":"<ключ>","target":"<запрос/url/кластер или пусто>","why":"<короткое обоснование по данным>"}]`;
  let raw;
  try { raw = await ask(sys, user, { maxTokens: 900, temperature: 0.3 }); }
  catch (e) { return [{ action: 'generate_new', why: `планировщик недоступен (${e.message}) — дефолтная генерация` }]; }
  try {
    const json = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1);
    const plan = JSON.parse(json);
    return Array.isArray(plan) ? plan.filter((p) => p && ACTIONS[p.action]).slice(0, maxActions) : [];
  } catch {
    return [{ action: 'generate_new', why: 'не удалось разобрать план — дефолтная генерация' }];
  }
}
