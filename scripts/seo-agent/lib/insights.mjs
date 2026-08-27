// SEO-инсайты для мозга агента («NeAhrefs-lite» на данных Яндекс.Вебмастера + история показов).
// Actionable-сигналы в perceive(), на которых агент действует:
//   • striking distance — запросы на поз. 3–20 с высоким спросом: один пуш контента = топ-3;
//   • position drops — что просело с прошлого замера → приоритет на дожим;
//   • content decay — страницы/запросы, теряющие показы день-к-дню → refresh, пока не поздно;
//   • crawl health — проблемы сайта из Яндекс-диагностики (битые ссылки, дубли и т.п.) → фикс.
// Google-версия (GSC) — тем же паттерном, когда включён Google-канал (см. lib/gsc.mjs).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR } from '../config.mjs';
import { webmasterReady, popularQueries, brokenInternalLinks, diagnostics } from './webmaster.mjs';

const HIST = join(ROOT_DIR, 'scripts/seo-agent/data/agent/insights-prev.json');
const today = () => new Date().toISOString().slice(0, 10);
const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return d; } };

/**
 * @param {Record<string,number>} priorPositions — карта запрос→позиция с прошлого прогона (report-state.positions).
 * @returns {Promise<null|{striking_distance, position_drops, content_decay, broken_links, crawl_health}>}
 */
export async function seoInsights(priorPositions = {}) {
  if (!webmasterReady()) return null;
  let q = [];
  try { q = await popularQueries({ limit: 200 }); } catch { return null; }

  // Striking distance: поз. 3–20, есть показы, CTR низкий (есть куда расти). Сорт по показам.
  const striking = q
    .filter((x) => x.position != null && x.position >= 3 && x.position <= 20 && (x.shows ?? 0) >= 4)
    .map((x) => ({ query: x.query, pos: Math.round(x.position * 10) / 10, shows: x.shows, clicks: x.clicks, ctr: x.shows ? +(x.clicks / x.shows).toFixed(3) : 0 }))
    .sort((a, b) => b.shows - a.shows)
    .slice(0, 8);

  // Просадки: позиция ухудшилась ≥2 пунктов относительно прошлого замера.
  const drops = q
    .filter((x) => x.position != null && priorPositions[x.query] != null && x.position > priorPositions[x.query] + 2)
    .map((x) => ({ query: x.query, was: Math.round(priorPositions[x.query] * 10) / 10, now: Math.round(x.position * 10) / 10, delta: +(x.position - priorPositions[x.query]).toFixed(1) }))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 6);

  // Content decay: сравнение показов/кликов с прошлым СНИМКОМ (день-к-дню). Снимок обновляем 1×/день.
  const prev = readJson(HIST, { date: '', stats: {} });
  const curStats = {};
  for (const x of q) curStats[x.query] = { shows: x.shows ?? 0, clicks: x.clicks ?? 0 };
  let decay = [];
  if (prev.date && prev.date !== today() && prev.stats) {
    decay = q
      .map((x) => {
        const p = prev.stats[x.query];
        if (!p || (p.shows ?? 0) < 5) return null;
        const dShows = (p.shows - (x.shows ?? 0)) / p.shows;                       // доля падения показов
        const lostClicks = (p.clicks ?? 0) > 0 && (x.clicks ?? 0) === 0;           // были клики → стало 0
        if (dShows < 0.4 && !lostClicks) return null;
        return { query: x.query, shows_was: p.shows, shows_now: x.shows ?? 0, drop_pct: Math.round(dShows * 100), lost_clicks: lostClicks };
      })
      .filter(Boolean)
      .sort((a, b) => b.drop_pct - a.drop_pct)
      .slice(0, 6);
  }
  // обновить снимок раз в день (первый прогон нового дня)
  if (prev.date !== today()) {
    try { mkdirSync(join(ROOT_DIR, 'scripts/seo-agent/data/agent'), { recursive: true }); writeFileSync(HIST, JSON.stringify({ date: today(), stats: curStats }), 'utf-8'); } catch {}
  }

  let broken = 0;
  try { const bl = await brokenInternalLinks({ limit: 50 }); broken = Array.isArray(bl) ? bl.length : (Number(bl?.count ?? bl?.length) || 0); } catch {}

  // Crawl health: проблемы сайта из Яндекс-диагностики (даром, без краулинга).
  let crawl = null;
  try {
    const diag = await diagnostics();
    if (diag.length || broken) crawl = { problems: diag.length, broken_links: broken, top: diag.slice(0, 4).map((p) => ({ key: p.key, severity: p.severity })) };
  } catch {}

  return { striking_distance: striking, position_drops: drops, content_decay: decay, broken_links: broken, crawl_health: crawl };
}

/** Короткая строка для лога/отчёта. */
export function insightsLine(ins) {
  if (!ins) return '';
  const parts = [];
  if (ins.striking_distance?.length) parts.push(`🎯 striking: ${ins.striking_distance.length} (напр. «${ins.striking_distance[0].query}» поз.${ins.striking_distance[0].pos})`);
  if (ins.position_drops?.length) parts.push(`📉 просели: ${ins.position_drops.length}`);
  if (ins.content_decay?.length) parts.push(`🍂 decay: ${ins.content_decay.length}`);
  if (ins.crawl_health?.problems || ins.broken_links) parts.push(`🩺 проблем: ${ins.crawl_health?.problems ?? 0}, битых ссылок: ${ins.broken_links}`);
  return parts.join(' · ');
}
