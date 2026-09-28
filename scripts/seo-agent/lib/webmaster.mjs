// Яндекс.Вебмастер API v4: популярные запросы, позиции, переобход.
import { CONFIG, DEFAULT_HEADERS } from '../config.mjs';

const { token, userId, hostId } = CONFIG.yandexWebmaster;
const BASE = 'https://api.webmaster.yandex.net/v4';
const H = () => ({ ...DEFAULT_HEADERS, Authorization: `OAuth ${token}` });

export const webmasterReady = () => Boolean(token && userId && hostId);

async function wm(path, init) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...H(), ...(init?.headers || {}) }, signal: AbortSignal.timeout(30_000) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`webmaster HTTP ${res.status}: ${data?.error_message || ''}`);
      return data;
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 700)); // ретрай на сетевой сбой
    }
  }
  throw lastErr;
}

const hostPath = (p) => `/user/${userId}/hosts/${encodeURIComponent(hostId)}${p}`;

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

/** Аналитика запросов: спрос (DEMAND), показы, клики, CTR + релевантный URL по каждому запросу. */
export async function queryAnalytics({ limit = 500 } = {}) {
  if (!webmasterReady()) return [];
  try {
    const data = await wm(`/user/${userId}/hosts/${encodeURIComponent(hostId)}/query-analytics/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offset: 0,
        limit,
        device_type_indicator: 'ALL',
        text_indicator: 'QUERY',
        region_ids: [],
        filters: {},
        order_by: 'TOTAL_SHOWS',
      }),
    });
    const out = [];
    for (const item of data.text_indicator_to_statistics || []) {
      const q = item.text_indicator?.value;
      const url = item.popular_complementary_indicator?.value || '';
      let impressions = 0, clicks = 0, demandSum = 0, demandN = 0;
      for (const s of item.statistics || []) {
        if (s.field === 'IMPRESSIONS') impressions += s.value;
        else if (s.field === 'CLICKS') clicks += s.value;
        else if (s.field === 'DEMAND') { demandSum += s.value; demandN++; }
      }
      const demand = demandN ? demandSum / demandN : 0;
      out.push({ query: q, url, impressions, clicks, demand, ctr: impressions ? clicks / impressions : 0 });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Запросы с высоким рыночным спросом (DEMAND), по которым у сайта 0 кликов → кандидаты на НОВЫЕ
 * страницы. DEMAND — спрос независимо от текущей видимости сайта (в отличие от показов, которые
 * требуют, чтобы сайт уже где-то показывался). Возвращает топ по спросу.
 * Живёт здесь (а не в ctr-optimize.mjs), чтобы demand-аналитика была доступна и в daily-report,
 * и на сайтах, у которых свой bespoke ctr-optimize (vradok) вне fanout ядра.
 */
export async function demandGaps({ minDemand = 1, limit = 500, top = 8 } = {}) {
  const rows = await queryAnalytics({ limit });
  return rows
    .filter((r) => r.demand >= minDemand && r.clicks === 0)
    .sort((a, b) => b.demand - a.demand || b.impressions - a.impressions)
    .slice(0, top);
}

/** Сводка по сайту: ИКС (SQI), страниц в поиске/исключено, счётчики проблем. */
export async function summary() {
  if (!webmasterReady()) return null;
  try {
    const d = await wm(hostPath('/summary'));
    return {
      sqi: d.sqi ?? null,
      searchable: d.searchable_pages_count ?? 0,
      excluded: d.excluded_pages_count ?? 0,
      problems: d.site_problems || {},
    };
  } catch { return null; }
}

/** Образцы обхода: URL со статусом и HTTP-кодом (ищем 4xx/5xx). */
export async function indexingSamples({ limit = 100 } = {}) {
  if (!webmasterReady()) return [];
  try {
    const d = await wm(hostPath(`/indexing/samples?limit=${limit}`));
    return (d.samples || []).map((s) => ({ url: s.url, status: s.status, httpCode: s.http_code, accessDate: s.access_date }));
  } catch { return []; }
}

/** Страницы, реально присутствующие в поиске Яндекса. */
export async function inSearchSamples({ limit = 200 } = {}) {
  if (!webmasterReady()) return [];
  try {
    const d = await wm(hostPath(`/search-urls/in-search/samples?limit=${limit}`));
    return (d.samples || []).map((s) => ({ url: s.url, title: s.title, lastAccess: s.last_access }));
  } catch { return []; }
}

/** События поиска: сколько появилось/выпало (последняя точка) + был ли отвал недавно. */
export async function searchEvents({ dateFrom, dateTo } = {}) {
  if (!webmasterReady()) return { appeared: 0, removed: 0, removedRecently: false };
  try {
    const qs = dateFrom && dateTo ? `?date_from=${dateFrom}&date_to=${dateTo}` : '';
    const d = await wm(hostPath(`/search-urls/events/history${qs}`));
    const last = (arr) => (arr && arr.length ? arr[arr.length - 1].value : 0);
    const removedArr = d.indicators?.REMOVED_FROM_SEARCH || [];
    return {
      appeared: last(d.indicators?.APPEARED_IN_SEARCH),
      removed: last(removedArr),
      removedRecently: removedArr.slice(-3).some((x) => x.value > 0),
    };
  } catch { return { appeared: 0, removed: 0, removedRecently: false }; }
}

/** Битые внутренние ссылки: {count, links[]}. */
export async function brokenInternalLinks({ limit = 100 } = {}) {
  if (!webmasterReady()) return { count: 0, links: [] };
  try {
    const d = await wm(hostPath(`/links/internal/broken/samples?limit=${limit}`));
    return { count: d.count || 0, links: d.links || [] };
  } catch { return { count: 0, links: [] }; }
}

/** Число внешних ссылок (сигнал траста) — для мониторинга роста. */
export async function externalLinksCount() {
  if (!webmasterReady()) return 0;
  try {
    const d = await wm(hostPath('/links/external/samples?limit=1'));
    return d.count || 0;
  } catch { return 0; }
}

/** Активные проблемы диагностики (state=PRESENT). */
export async function diagnostics() {
  if (!webmasterReady()) return [];
  try {
    const d = await wm(hostPath('/diagnostics/'));
    const out = [];
    for (const [key, v] of Object.entries(d.problems || {})) {
      if (v.state === 'PRESENT') out.push({ key, severity: v.severity, since: v.last_state_update });
    }
    return out;
  } catch { return []; }
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
