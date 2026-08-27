// Topvisor API — трекинг позиций по ключам в Яндексе И Google. ОПТ-ИН: работает только если задан
// TOPVISOR_LOGIN + TOPVISOR_KEY. Полезен прежде всего для Google-позиций (у Яндекса свой Вебмастер),
// но снимает и Яндекс. По умолчанию (нет ключа) молчит — агент на бесплатном xmlstock/Вебмастере.
//
// Docs: https://topvisor.com/ru/api/  Аутентификация: заголовки User-Id + Authorization: bearer <key>.
// ВАЖНО: User-Id — ЧИСЛОВОЙ id аккаунта (напр. 3962), НЕ email (email → «Authorisation error»).
// Топвизор-поисковики (search engine id): 0 = Яндекс, 1 = Google. Регион задаётся в проекте Топвизора.
import { CONFIG } from '../config.mjs';

const BASE = 'https://api.topvisor.com/v2';
const { userId, key, projectId } = CONFIG.topvisor;

/** Готов ли Topvisor (заданы User-Id+ключ). false → трекинг позиций через бесплатные источники. */
export function topvisorReady() { return Boolean(userId && key); }

async function call(endpoint, payload) {
  if (!topvisorReady()) throw new Error('topvisor: не заданы TOPVISOR_USER_ID/TOPVISOR_KEY');
  const r = await fetch(`${BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Id': String(userId), Authorization: `bearer ${key}` },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(30000),
  });
  const j = await r.json();
  if (j.errors?.length) throw new Error(`topvisor: ${JSON.stringify(j.errors).slice(0, 160)}`);
  return j.result ?? j;
}

/** Список проектов аккаунта (чтобы узнать project id). */
export async function projects() {
  return call('get/projects_2/projects', { fields: ['id', 'name', 'site'] });
}

/**
 * Регионы/поисковики проекта. Возвращает [{ searcher, name, regionIndex }].
 * CSV-колонки Топвизора: [searcher_key, searcher_name, country, lang, ?, region_index].
 */
export async function projectRegions(project = projectId) {
  if (!topvisorReady()) throw new Error('topvisor: не заданы TOPVISOR_USER_ID/TOPVISOR_KEY');
  const r = await fetch(`${BASE}/get/positions_2/searchers/regions/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Id': String(userId), Authorization: `bearer ${key}` },
    body: JSON.stringify({ project_id: Number(project) }), signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  return text.trim().split('\n').filter(Boolean).map((line) => {
    const c = line.split(';');
    return { searcher: Number(c[0]), name: c[1], regionIndex: Number(c[c.length - 1]) };
  });
}

/**
 * Снимок позиций проекта. searcher: 0=Яндекс (по умолчанию — основа агента), 1=Google.
 * regionIndex авто-определяется из проекта, если не задан. Даты — диапазон date1/date2 (Топвизор API).
 * Возвращает [{ query, position }] по последнему замеру в окне.
 */
export async function positions({ project = projectId, searcher = 0, regionIndex, days = 30 } = {}) {
  if (!project) throw new Error('topvisor: не задан TOPVISOR_PROJECT_ID (см. projects())');
  // авто-регион под выбранный поисковик
  if (regionIndex == null) {
    try {
      const regs = await projectRegions(project);
      regionIndex = (regs.find((x) => x.searcher === searcher) || regs[0])?.regionIndex ?? 0;
    } catch { regionIndex = 0; }
  }
  const d2 = new Date().toISOString().slice(0, 10);
  const d1 = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const res = await call('get/positions_2/history', {
    project_id: Number(project),
    regions_indexes: [regionIndex],
    date1: d1, date2: d2,
    show_headers: true,
    positions_fields: ['position'],
    count_dates: 2,
  });
  const keywords = res?.keywords || [];
  return keywords.map((k) => {
    // берём самый свежий столбец с позицией
    const cells = k.positionsData ? Object.values(k.positionsData) : [];
    const last = cells.reverse().find((c) => c && c.position != null);
    return { query: k.name || k.query, position: last?.position != null ? Number(last.position) : null };
  }).filter((x) => x.query);
}

/** Сводка топ-10/топ-30 по проекту для выбранного движка. */
export async function summary({ project = projectId, searcher = 0, regionIndex = 0 } = {}) {
  const pos = await positions({ project, searcher, regionIndex });
  const valid = pos.filter((p) => Number.isFinite(p.position));
  const top10 = valid.filter((p) => p.position <= 10).length;
  const top30 = valid.filter((p) => p.position > 10 && p.position <= 30).length;
  return { engine: searcher === 1 ? 'google' : 'yandex', tracked: valid.length, top10, top30, best: valid.sort((a, b) => a.position - b.position).slice(0, 8) };
}

// CLI: node scripts/seo-agent/lib/topvisor.mjs   (покажет проекты, если project id не задан)
import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    if (!topvisorReady()) { console.log('Topvisor не настроен (нет TOPVISOR_USER_ID/TOPVISOR_KEY).'); return; }
    if (!projectId) { console.log('Проекты аккаунта:', JSON.stringify(await projects(), null, 2)); return; }
    const y = await summary({ searcher: 0 });
    console.log(`Яндекс: топ-10 ${y.top10}, топ-30 ${y.top30} из ${y.tracked}`);
    const g = await summary({ searcher: 1 });
    console.log(`Google: топ-10 ${g.top10}, топ-30 ${g.top30} из ${g.tracked}`);
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
