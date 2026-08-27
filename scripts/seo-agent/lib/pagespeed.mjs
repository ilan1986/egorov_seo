// Замер Core Web Vitals через Google PageSpeed Insights v5 (бесплатный API, покрывает РФ-сайты).
// Ключ опционален (PAGESPEED_KEY) — без него работает с квотой. Из claude-seo pagespeed_check.py.
export async function pageSpeed(url, { strategy = 'mobile', key = process.env.PAGESPEED_KEY || '' } = {}) {
  const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&category=performance${key ? `&key=${key}` : ''}`;
  try {
    const r = await fetch(api, { signal: AbortSignal.timeout(60000) });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d) return { ok: false, error: d?.error?.message || `HTTP ${r.status}` };
    const lh = d.lighthouseResult?.audits || {};
    const cats = d.lighthouseResult?.categories || {};
    const crux = d.loadingExperience?.metrics || {};
    const p = (m) => crux[m]?.percentile;
    return {
      ok: true, strategy,
      perf: Math.round((cats.performance?.score || 0) * 100),
      lcp: lh['largest-contentful-paint']?.displayValue
        || (p('LARGEST_CONTENTFUL_PAINT_MS') != null ? (p('LARGEST_CONTENTFUL_PAINT_MS') / 1000).toFixed(1) + ' с' : null),
      inp: p('INTERACTION_TO_NEXT_PAINT') != null ? p('INTERACTION_TO_NEXT_PAINT') + ' мс'
        : (p('FIRST_INPUT_DELAY_MS') != null ? p('FIRST_INPUT_DELAY_MS') + ' мс' : null),
      cls: lh['cumulative-layout-shift']?.displayValue
        || (p('CUMULATIVE_LAYOUT_SHIFT_SCORE') != null ? (p('CUMULATIVE_LAYOUT_SHIFT_SCORE') / 100).toFixed(2) : null),
      field: !!d.loadingExperience?.metrics, // есть ли полевые данные CrUX (реальные пользователи)
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
export function cwvReportLine(ps) {
  if (!ps || !ps.ok) return `CWV: нет данных${ps?.error ? ' (' + String(ps.error).slice(0, 40) + ')' : ''}`;
  const flag = ps.perf >= 90 ? '🟢' : ps.perf >= 50 ? '🟡' : '🔴';
  return `CWV ${flag} (${ps.strategy}${ps.field ? ', реальные' : ', лаб'}): Perf ${ps.perf} · LCP ${ps.lcp || '—'} · INP ${ps.inp || '—'} · CLS ${ps.cls || '—'}`;
}
