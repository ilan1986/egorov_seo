// Яндекс.Метрика API: трафик и поведение по страницам.
import { CONFIG, DEFAULT_HEADERS } from '../config.mjs';

const { token, counter } = CONFIG.yandexMetrika;
const BASE = 'https://api-metrika.yandex.net/stat/v1/data';
const H = () => ({ ...DEFAULT_HEADERS, Authorization: `OAuth ${token}` });

export const metrikaReady = () => Boolean(token && counter);

/** Просмотры/отказы/время по страницам за период. Пусто для нового сайта. */
export async function pageStats({ days = 30 } = {}) {
  if (!metrikaReady()) return [];
  try {
    const url =
      `${BASE}?ids=${counter}&metrics=ym:s:pageviews,ym:s:bounceRate,ym:s:avgVisitDurationSeconds` +
      `&dimensions=ym:s:startURLPath&date1=${days}daysAgo&date2=today&limit=200&accuracy=full`;
    const res = await fetch(url, { headers: H() });
    const data = await res.json().catch(() => null);
    if (!res.ok) return [];
    return (data?.data || []).map((row) => ({
      path: row.dimensions?.[0]?.name,
      pageviews: row.metrics?.[0] ?? 0,
      bounceRate: row.metrics?.[1] ?? 0,
      avgDuration: row.metrics?.[2] ?? 0,
    }));
  } catch {
    return [];
  }
}
