// Движок свежести (GEO): находит статьи-кандидаты на цитирование старше N дней и ставит их
// в очередь на рефреш (обновить факты/цифры/год + поднять dateModified). Бенчмарк GEO:
// ~76% топ-цитируемых нейросетями страниц обновлены за последние 30 дней (blog-geo/seo-geo).
// Дополняет lib/health.mjs (там же живут refreshCandidates/refreshPage). Работает по фронтматтеру.
import { PROFILE } from '../../../site.profile.mjs';

const parseDate = (s) => { const t = Date.parse(s); return Number.isNaN(t) ? null : t; };

/**
 * Найти устаревшие страницы среди переданных.
 * @param {Array<{slug,url,title,pubDate,dateModified?,keywords?}>} pages — существующие страницы (из existingPages())
 * @param {object} [opt] — { days=30, limit=10 }
 * @returns {Array} отсортировано от самых старых, с полем ageDays
 */
export function freshnessGaps(pages = [], { days = 30, limit = 10 } = {}) {
  const now = Date.now();
  const thr = days * 864e5;
  const out = [];
  for (const p of pages) {
    const ref = parseDate(p.dateModified) ?? parseDate(p.pubDate);
    if (ref == null) continue;
    const ageDays = Math.round((now - ref) / 864e5);
    if (now - ref >= thr) out.push({ ...p, ageDays });
  }
  out.sort((a, b) => b.ageDays - a.ageDays);
  return out.slice(0, limit);
}

/** Строка для daily-report: доля свежих (≤days) страниц. */
export function freshnessReportLine(pages = [], days = 30) {
  const total = pages.length || 0;
  if (!total) return '';
  const now = Date.now(), thr = days * 864e5;
  const fresh = pages.filter((p) => {
    const ref = parseDate(p.dateModified) ?? parseDate(p.pubDate);
    return ref != null && now - ref < thr;
  }).length;
  const pct = Math.round((fresh / total) * 100);
  return `🕐 Свежесть: ${pct}% страниц обновлены за ${days} дн. (${fresh}/${total})`;
}
