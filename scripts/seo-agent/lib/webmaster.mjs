// Яндекс.Вебмастер API v4: популярные запросы, позиции, переобход.
import { CONFIG, DEFAULT_HEADERS } from '../config.mjs';

const { token, userId, hostId } = CONFIG.yandexWebmaster;
const BASE = 'https://api.webmaster.yandex.net/v4';
const H = () => ({ ...DEFAULT_HEADERS, Authorization: `OAuth ${token}` });

export const webmasterReady = () => Boolean(token && userId && hostId);

async function wm(path, init) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...H(), ...(init?.headers || {}) } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`webmaster HTTP ${res.status}: ${data?.error_message || ''}`);
  return data;
}

/** Популярные поисковые запросы сайта (реальные показы/клики/позиции). Пусто для нового сайта. */
export async function popularQueries({ limit = 100 } = {}) {
  if (!webmasterReady()) return [];
  try {
    const q =
      `/user/${userId}/hosts/${encodeURIComponent(hostId)}/search-queries/popular` +
      `?order_by=TOTAL_SHOWS&query_indicator=TOTAL_SHOWS&query_indicator=TOTAL_CLICKS` +
      `&query_indicator=AVG_SHOW_POSITION&limit=${limit}`;
    const data = await wm(q);
    return (data.queries || []).map((x) => ({
      query: x.query_text,
      shows: x.indicators?.TOTAL_SHOWS ?? 0,
      clicks: x.indicators?.TOTAL_CLICKS ?? 0,
      position: x.indicators?.AVG_SHOW_POSITION ?? null,
    }));
  } catch {
    return [];
  }
}

/** Поставить URL в очередь переобхода. */
export async function recrawl(url) {
  if (!webmasterReady()) return false;
  try {
    await wm(`/user/${userId}/hosts/${encodeURIComponent(hostId)}/recrawl/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    return true;
  } catch {
    return false;
  }
}
