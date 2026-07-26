// Composite GEO Score — единая метрика «готовности к цитированию нейросетями» для daily-report.
// Формула весов из geo-audit/geo-report, адаптирована под то, что агент реально измеряет.
// Все входы опциональны (передаются готовыми из других модулей) — считаем по доступным.
//
// Категории и веса (нормируются по доступным):
//   AI Citability 25% · Brand Authority 20% · E-E-A-T 20% · Technical 15% · Schema 10% · AI SoV 10%

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * @param {object} p — { citability, brandAuthority, eeat, technical, schema, aiSov } — каждый 0-100 или null
 * @returns {{score:number, rating:string, parts:object}}
 */
export function compositeGeoScore(p = {}) {
  const W = { citability: 25, brandAuthority: 20, eeat: 20, technical: 15, schema: 10, aiSov: 10 };
  let sum = 0, wsum = 0;
  const parts = {};
  for (const [k, w] of Object.entries(W)) {
    const v = p[k];
    if (v == null || Number.isNaN(v)) continue;
    parts[k] = clamp(v);
    sum += parts[k] * w;
    wsum += w;
  }
  const score = wsum ? clamp(sum / wsum) : null;
  return { score, rating: ratingOf(score), parts, coverage: `${wsum}/100 весов измерено` };
}

export function ratingOf(s) {
  if (s == null) return 'нет данных';
  if (s >= 90) return 'отлично';
  if (s >= 75) return 'хорошо';
  if (s >= 60) return 'средне';
  if (s >= 40) return 'слабо';
  return 'критично';
}

/** Строка для daily-report с дельтой против прошлого значения (из report-state.json). */
export function geoScoreLine(cur, prev) {
  if (cur?.score == null) return '📐 GEO-score: нет данных (нужны citability/eeat/probe).';
  const trend = prev == null ? '🆕' : cur.score > prev ? `▲ +${cur.score - prev}` : cur.score < prev ? `▼ ${cur.score - prev}` : '=';
  const parts = Object.entries(cur.parts).map(([k, v]) => `${k}:${v}`).join(' ');
  return `📐 GEO-score: ${cur.score}/100 (${cur.rating}) ${trend}\n   ${parts}`;
}
