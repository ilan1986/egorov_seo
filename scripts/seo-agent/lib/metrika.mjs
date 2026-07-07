// Яндекс.Метрика API: трафик и поведение по страницам.
import { CONFIG, DEFAULT_HEADERS } from '../config.mjs';

const { token, counter } = CONFIG.yandexMetrika;
const BASE = 'https://api-metrika.yandex.net/stat/v1/data';
const MGMT = 'https://api-metrika.yandex.net/management/v1';
const H = () => ({ ...DEFAULT_HEADERS, Authorization: `OAuth ${token}` });

export const metrikaReady = () => Boolean(token && counter);

async function stat(params) {
  if (!metrikaReady()) return null;
  try {
    const res = await fetch(`${BASE}?ids=${counter}&accuracy=full&${params}`, { headers: H(), signal: AbortSignal.timeout(30_000) });
    const data = await res.json().catch(() => null);
    return res.ok ? data : null;
  } catch { return null; }
}

// Цель конверсии (отправка формы). Кэшируем ТОЛЬКО успешный ответ (сбой не должен «отравить» кэш).
let _goalId;
export async function goalId() {
  if (_goalId) return _goalId;
  if (!metrikaReady()) return null;
  try {
    const res = await fetch(`${MGMT}/counter/${counter}/goals`, { headers: H(), signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const d = await res.json();
    const active = (d.goals || []).filter((g) => g.status === 'Active');
    const form = active.find((g) => g.type === 'form') || active[0];
    if (form) return (_goalId = form.id);
    return null;
  } catch { return null; }
}

/** Состояние счётчика: код (норм/ошибка) + активность. */
export async function counterHealth() {
  if (!metrikaReady()) return null;
  try {
    const d = await (await fetch(`${MGMT}/counter/${counter}`, { headers: H(), signal: AbortSignal.timeout(30_000) })).json();
    return { codeStatus: d.counter?.code_status || null, activity: d.counter?.activity_status || null };
  } catch { return null; }
}

/** Итоги за период + конверсии (заявки с формы). */
export async function metrikaTotals({ days = 30 } = {}) {
  const gid = await goalId();
  const gm = gid ? `,ym:s:goal${gid}reaches,ym:s:goal${gid}conversionRate` : '';
  const d = await stat(`metrics=ym:s:visits,ym:s:users,ym:s:pageviews,ym:s:bounceRate,ym:s:avgVisitDurationSeconds${gm}&date1=${days}daysAgo&date2=today`);
  const t = d?.totals || [];
  return {
    visits: t[0] || 0, users: t[1] || 0, pageviews: t[2] || 0,
    bounce: t[3] || 0, avgDuration: t[4] || 0,
    conversions: gid ? (t[5] || 0) : null, convRate: gid ? (t[6] || 0) : null,
  };
}

/** Посадочные страницы: визиты, отказы, время, заявки — для конверс-оптимизатора и рефреша. */
export async function metrikaLanding({ days = 90, limit = 100 } = {}) {
  const gid = await goalId();
  const gm = gid ? `,ym:s:goal${gid}reaches` : '';
  const d = await stat(`metrics=ym:s:visits,ym:s:bounceRate,ym:s:avgVisitDurationSeconds${gm}&dimensions=ym:s:startURLPath&date1=${days}daysAgo&date2=today&limit=${limit}&sort=-ym:s:visits`);
  return (d?.data || []).map((r) => ({
    path: r.dimensions?.[0]?.name, visits: r.metrics?.[0] || 0,
    bounce: r.metrics?.[1] || 0, avgDuration: r.metrics?.[2] || 0,
    conversions: gid ? (r.metrics?.[3] || 0) : 0,
  })).filter((x) => x.path);
}

/** Источники трафика (+заявки по каждому). */
export async function metrikaSources({ days = 90 } = {}) {
  const gid = await goalId();
  const gm = gid ? `,ym:s:goal${gid}reaches` : '';
  const d = await stat(`metrics=ym:s:visits${gm}&dimensions=ym:s:lastsignTrafficSource&date1=${days}daysAgo&date2=today`);
  return (d?.data || []).map((r) => ({
    source: r.dimensions?.[0]?.name, visits: r.metrics?.[0] || 0,
    conversions: gid ? (r.metrics?.[1] || 0) : 0,
  }));
}

/** Трафик и поведение строго за СЕГОДНЯ (для ежедневного отчёта, не за период). */
export async function metrikaToday() {
  const d = await stat(`metrics=ym:s:visits,ym:s:users,ym:s:pageviews,ym:s:bounceRate,ym:s:avgVisitDurationSeconds&date1=today&date2=today`);
  const t = d?.totals || [];
  return { visits: t[0] || 0, users: t[1] || 0, pageviews: t[2] || 0, bounce: t[3] || 0, avgDuration: t[4] || 0 };
}

// Домены мессенджеров — распознаём "Messenger traffic" внутри общего Link traffic (referral),
// т.к. у Яндекс.Метрики нет отдельной категории источника под мессенджеры.
const MESSENGER_DOMAINS = ['t.me', 'telegram.me', 'wa.me', 'api.whatsapp.com', 'web.whatsapp.com', 'vk.me', 'viber.com', 'max.ru'];

/** Источники трафика за СЕГОДНЯ, разложенные ровно на 5 категорий юзер-формата отчёта. */
export async function trafficSourcesToday() {
  const d = await stat(`metrics=ym:s:visits&dimensions=ym:s:lastsignTrafficSource,ym:s:lastsignReferalSource&date1=today&date2=today`);
  const rows = d?.data || [];
  const out = { direct: 0, internal: 0, messenger: 0, search: 0, link: 0 };
  for (const r of rows) {
    const id = r.dimensions?.[0]?.id;
    const ref = (r.dimensions?.[1]?.name || '').toLowerCase();
    const visits = r.metrics?.[0] || 0;
    if (id === 'direct') out.direct += visits;
    else if (id === 'internal') out.internal += visits;
    else if (id === 'organic') out.search += visits;
    else if (id === 'referral') {
      if (MESSENGER_DOMAINS.some((m) => ref.endsWith(m))) out.messenger += visits;
      else out.link += visits;
    } else out.link += visits; // social/ad/recommend и прочее — считаем как переходы по ссылке
  }
  return out;
}

/** Реальные поисковые фразы, приведшие людей на сайт (для генерации тем/FAQ). */
export async function metrikaPhrases({ days = 90, limit = 25 } = {}) {
  const d = await stat(`metrics=ym:s:visits&dimensions=ym:s:searchPhrase&date1=${days}daysAgo&date2=today&limit=${limit}&sort=-ym:s:visits`);
  return (d?.data || []).map((r) => ({ phrase: r.dimensions?.[0]?.name, visits: r.metrics?.[0] || 0 }))
    .filter((x) => x.phrase && !/^\(|not set|none/i.test(x.phrase));
}

/** Просмотры/отказы/время по страницам за период. Пусто для нового сайта. */
export async function pageStats({ days = 30 } = {}) {
  if (!metrikaReady()) return [];
  try {
    const url =
      `${BASE}?ids=${counter}&metrics=ym:s:pageviews,ym:s:bounceRate,ym:s:avgVisitDurationSeconds` +
      `&dimensions=ym:s:startURLPath&date1=${days}daysAgo&date2=today&limit=200&accuracy=full`;
    const res = await fetch(url, { headers: H(), signal: AbortSignal.timeout(30_000) });
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
