// CTR-оптимизатор (шаг 6 воркфлоу): страницы с показами, но без кликов →
// переписываем seoTitle/description под реальные запросы Яндекса, чтобы поднять кликабельность.
import { queryAnalytics } from './webmaster.mjs';
import { fileForUrl, readMeta, updateMeta, urlPath } from './content.mjs';
import { ask } from './aigate.mjs';

const clip = (s, n) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n).replace(/[\s,;:–—-]+$/, '');

/** Сгруппировать аналитику запросов по URL страницы. */
function groupByUrl(rows) {
  const byUrl = new Map();
  for (const r of rows) {
    if (!r.url) continue;
    const u = urlPath(r.url);
    const e = byUrl.get(u) || { url: u, impressions: 0, clicks: 0, demand: 0, queries: [] };
    e.impressions += r.impressions;
    e.clicks += r.clicks;
    e.demand += r.demand;
    e.queries.push({ query: r.query, impressions: r.impressions, demand: r.demand });
    byUrl.set(u, e);
  }
  for (const e of byUrl.values()) e.queries.sort((a, b) => b.impressions - a.impressions);
  return [...byUrl.values()];
}

/**
 * Кандидаты на CTR-оптимизацию: показов ≥ minImpr, кликов 0 (или CTR ниже порога).
 * Возвращает отсортированные по числу показов.
 */
export async function ctrCandidates({ minImpr = 5, maxCtr = 0.005, limit = 500 } = {}) {
  const rows = await queryAnalytics({ limit });
  const pages = groupByUrl(rows).filter((p) => fileForUrl(p.url));
  return pages
    .filter((p) => p.impressions >= minImpr && p.impressions * maxCtr >= p.clicks)
    .sort((a, b) => b.impressions - a.impressions);
}

/**
 * Запросы с высоким спросом, по которым нас нет среди кликов/показов на наших страницах →
 * кандидаты на НОВЫЕ страницы. Возвращает топ по DEMAND.
 */
export async function demandGaps({ minDemand = 1, limit = 500, top = 8 } = {}) {
  const rows = await queryAnalytics({ limit });
  const gaps = rows
    .filter((r) => r.demand >= minDemand && r.clicks === 0)
    .sort((a, b) => b.demand - a.demand || b.impressions - a.impressions);
  return gaps.slice(0, top);
}

const SYS =
  'Ты SEO-редактор. Пишешь кликабельные, честные заголовки и описания для сниппета Яндекса ' +
  'на русском. Без кликбейта и обещаний, без CAPS. Возвращаешь строго две строки:\n' +
  'TITLE: <заголовок, до 58 символов, с ключевым словом>\n' +
  'DESC: <описание, 120–160 символов, с выгодой и мягким призывом>';

/** Переписать seoTitle+description одной страницы под её реальные запросы. */
export async function rewriteMeta(page, { apply = true } = {}) {
  const file = fileForUrl(page.url);
  if (!file) return null;
  const cur = readMeta(file);
  const qs = page.queries.slice(0, 6).map((q) => q.query).filter(Boolean);
  const user =
    `Страница: ${page.url}\n` +
    `Текущий заголовок: ${cur.seoTitle || cur.title}\n` +
    `Текущее описание: ${cur.description}\n` +
    `Реальные запросы Яндекса (показы есть, кликов нет — ${page.impressions} показов):\n- ${qs.join('\n- ')}\n\n` +
    `Перепиши заголовок и описание так, чтобы человек кликнул именно на нас. ` +
    `Вставь самый частотный запрос естественно. Формат ответа — ровно две строки TITLE:/DESC:`;
  const out = await ask(SYS, user, { maxTokens: 300, temperature: 0.7 });
  const seoTitle = clip(out.match(/TITLE:\s*(.+)/i)?.[1] || '', 60);
  const description = clip(out.match(/DESC:\s*(.+)/i)?.[1] || '', 165);
  if (!seoTitle || !description) return null;
  if (apply) updateMeta(file, { seoTitle, description, updated: new Date().toISOString().slice(0, 10) });
  return { url: page.url, impressions: page.impressions, was: cur.seoTitle || cur.title, now: seoTitle };
}

/** Прогнать CTR-оптимизацию по топ-N кандидатам. Возвращает список изменённых страниц. */
export async function optimizeCtr({ limit = 3, minImpr = 5, apply = true } = {}) {
  const cands = await ctrCandidates({ minImpr });
  const changed = [];
  for (const page of cands.slice(0, limit)) {
    try {
      const r = await rewriteMeta(page, { apply });
      if (r) changed.push(r);
    } catch { /* пропускаем сбойную страницу */ }
    await new Promise((res) => setTimeout(res, 600));
  }
  return changed;
}
