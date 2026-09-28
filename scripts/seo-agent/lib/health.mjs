// Мониторинг здоровья сайта в Вебмастере + авто-обслуживание:
//  · индексация: непроиндексированные/выпавшие страницы → переобход
//  · ошибки обхода 4xx/5xx → переобход + алерт
//  · битые внутренние ссылки → отчёт (+ безопасный фикс слэша)
//  · авто-рефреш страниц, застрявших на 2-й странице выдачи (11–30)
//  · диагностика, ИКС (SQI), внешние ссылки → в отчёт
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  summary, indexingSamples, inSearchSamples, searchEvents, brokenInternalLinks,
  externalLinksCount, diagnostics, popularQueries, queryAnalytics, recrawl,
} from './webmaster.mjs';
import { existingPages, fileForUrl, urlPath } from './content.mjs';
import { ROOT_DIR, CONFIG, DEFAULT_HEADERS } from '../config.mjs';
import { ask } from './aigate.mjs';

const DATA_DIR = join(ROOT_DIR, 'scripts/seo-agent/data');
const REFRESH_LOG = join(DATA_DIR, 'refreshed.json');
const RECRAWL_LOG = join(DATA_DIR, 'recrawl-submitted.json'); // {url: ISO} — когда URL последний раз слали в переобход
const today = () => new Date().toISOString().slice(0, 10);

const DIAG_LABELS = {
  URL_ALERT_4XX: 'Страницы отдают 4xx',
  URL_ALERT_5XX: 'Ошибки сервера 5xx',
  NOT_IN_SPRAV: 'Нет карточки в Яндекс.Бизнесе',
  DOCUMENTS_MISSING_DESCRIPTION: 'Страницы без description',
  NOT_MOBILE_FRIENDLY: 'Не адаптировано под мобильные',
  NO_SITEMAP: 'Не найден sitemap',
  SITEMAP_ERROR: 'Ошибки в sitemap',
  DISALLOW_IN_ROBOTS: 'Важные страницы закрыты в robots.txt',
  SLOW_AVG_RESPONSE_LAST_WEEK: 'Медленный ответ сервера',
  DNS_ERROR: 'Ошибка DNS',
  THREATS: 'Угрозы безопасности',
  MAIN_MIRROR_IS_NOT_HTTPS: 'Главное зеркало не на HTTPS',
  TOO_MANY_DOMAINS_ON_SEARCH: 'Много поддоменов в поиске',
};
export const diagLabel = (k) => DIAG_LABELS[k] || k;

// Диагностики Вебмастера, которые НЕ выносим в отчёт как проблему: favicon-семейство —
// SERP-косметика. Если на сайте реально отдаётся файл фавикона, статус снимается на
// переобходе Яндекса (пока лагает — это шум в отчёте, а не дефект). Реальные ошибки
// (4xx/5xx, robots, sitemap, DNS, угрозы) остаются.
const DIAG_IGNORE = new Set(['FAVICON_ERROR', 'BIG_FAVICON_ABSENT', 'FAVICON_PROBLEM']);

// ── Сбор данных мониторинга ──────────────────────────
export async function gatherHealth() {
  const dt = today();
  const dateFrom = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const [sum, idx, events, broken, extCount, diag] = await Promise.all([
    summary(), indexingSamples({ limit: 100 }), searchEvents({ dateFrom, dateTo: dt }),
    brokenInternalLinks({ limit: 100 }), externalLinksCount(), diagnostics(),
  ]);
  const crawlErrors = idx.filter((x) => x.httpCode && x.httpCode >= 400);
  return { summary: sum, events, broken, extCount, diag, crawlErrors, indexing: idx };
}

// ── Действие: переобход ошибок обхода и новых страниц ─
export async function fixIndexation(createdUrls = [], health = null) {
  const h = health || (await gatherHealth());
  const recrawled = [];
  // 1) URL с 4xx/5xx — попросить переобход (вдруг уже починено деплоем)
  for (const e of h.crawlErrors.slice(0, 10)) {
    if (await recrawl(e.url)) recrawled.push(e.url);
  }
  // 2) только что опубликованные, которых ещё нет в образцах обхода
  if (createdUrls.length) {
    const seen = new Set(h.indexing.map((x) => urlPath(x.url)));
    for (const u of createdUrls) {
      const abs = u.startsWith('http') ? u : null;
      const p = urlPath(u);
      if (!seen.has(p)) { if (await recrawl(abs || u)) recrawled.push(p); }
    }
  }
  return { recrawled, crawlErrors: h.crawlErrors };
}

// ── Досыл непроиндексированных страниц в переобход (постоянный) ──
// Для молодого сайта Яндекс индексирует медленно: опубликовано много, а в поиске единицы.
// fixIndexation() шлёт только свежие/битые; эта функция добирает ВСЕ уже опубликованные
// страницы, которых ещё нет в поиске, порциями с кулдауном — чтобы не выжигать дневную квоту
// переобхода и не долбить один и тот же URL каждую ночь (Яндекс от спама быстрее не индексирует).
function loadRecrawlLog() {
  if (!existsSync(RECRAWL_LOG)) return {};
  try { return JSON.parse(readFileSync(RECRAWL_LOG, 'utf-8')); } catch { return {}; }
}
function saveRecrawlLog(o) {
  try { writeFileSync(RECRAWL_LOG, JSON.stringify(o, null, 2), 'utf-8'); } catch {}
}

// Полный список URL сайта из sitemap (карта — источник истины: включает и статьи, и
// карточки каталога/районы/застройщиков, которых нет в existingPages). Fallback — existingPages.
async function allSiteUrls() {
  const base = CONFIG.siteUrl.replace(/\/$/, '');
  const fetchXml = async (u) => {
    try {
      const r = await fetch(u, { headers: DEFAULT_HEADERS, signal: AbortSignal.timeout(20_000) });
      return r.ok ? await r.text() : '';
    } catch { return ''; }
  };
  const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]);
  try {
    // пробуем sitemap-index и обычный sitemap
    let idx = await fetchXml(`${base}/sitemap-index.xml`);
    if (!idx) idx = await fetchXml(`${base}/sitemap.xml`);
    if (!idx) return existingPages().map((p) => base + p.url);
    const inner = locs(idx);
    // если это индекс (ссылки на другие sitemap-*.xml) — собираем из них
    const subs = inner.filter((u) => /sitemap.*\.xml$/i.test(u));
    if (subs.length) {
      const all = [];
      for (const s of subs) all.push(...locs(await fetchXml(s)));
      return [...new Set(all)];
    }
    return [...new Set(inner)]; // это уже обычный sitemap с URL страниц
  } catch {
    return existingPages().map((p) => base + p.url);
  }
}

/**
 * @param {object} opts
 * @param {number} opts.budget   сколько URL максимум досылать за прогон (беречь дневную квоту ~150)
 * @param {number} opts.cooldownDays  не слать тот же URL чаще, чем раз в N дней
 */
export async function resubmitUnindexed({ budget = 15, cooldownDays = 14 } = {}) {
  const urls = await allSiteUrls();
  const pages = urls.map((u) => ({ url: u }));
  if (!pages.length) return { submitted: [], unindexedTotal: 0 };

  // Страницы, которые Вебмастер уже показывает в поиске (best-effort: endpoint отдаёт образцы).
  const inSearch = await inSearchSamples({ limit: 2000 }).catch(() => []);
  const indexedPaths = new Set(inSearch.map((s) => urlPath(s.url)));

  const log = loadRecrawlLog();
  const now = Date.now();
  const cooldownMs = cooldownDays * 864e5;

  // непроиндексированные + не в кулдауне, самые «старые по досылу» первыми
  const candidates = pages
    .map((p) => ({ url: p.url, path: urlPath(p.url) }))
    .filter((p) => !indexedPaths.has(p.path))
    .filter((p) => {
      const last = log[p.path];
      return !last || now - Date.parse(last) > cooldownMs;
    })
    .sort((a, b) => (Date.parse(log[a.path] || 0)) - (Date.parse(log[b.path] || 0)));

  const unindexedTotal = pages.filter((p) => !indexedPaths.has(urlPath(p.url))).length;
  const submitted = [];
  for (const c of candidates.slice(0, budget)) {
    const abs = c.url.startsWith('http') ? c.url : CONFIG.siteUrl + c.url;
    if (await recrawl(abs)) {
      log[c.path] = new Date().toISOString();
      submitted.push(c.path);
    }
  }
  if (submitted.length) saveRecrawlLog(log);
  return { submitted, unindexedTotal };
}

// ── Битые внутренние ссылки: отчёт + безопасный фикс ──
export function describeBrokenLinks(broken) {
  // форма объекта может отличаться — берём вероятные поля
  return (broken.links || []).slice(0, 10).map((l) => {
    const from = l.source_url || l.source || l.from || l.page || '';
    const to = l.destination_url || l.broken_url || l.target || l.url || l.link || '';
    return { from: urlPath(from) || from, to };
  });
}

// ── Авто-рефреш застрявших страниц (позиции 11–30) ────
function loadRefreshLog() {
  if (!existsSync(REFRESH_LOG)) return {};
  try { return JSON.parse(readFileSync(REFRESH_LOG, 'utf-8')); } catch { return {}; }
}
function saveRefreshLog(o) { writeFileSync(REFRESH_LOG, JSON.stringify(o, null, 2), 'utf-8'); }

/** Кандидаты на рефреш: запрос с позицией 11–30, у которого есть наша страница. */
export async function refreshCandidates() {
  const [pop, qa] = await Promise.all([popularQueries({ limit: 100 }), queryAnalytics({ limit: 500 })]);
  const urlByQuery = new Map(qa.map((r) => [String(r.query).toLowerCase(), r.url]));
  const imprByQuery = new Map(qa.map((r) => [String(r.query).toLowerCase(), r.impressions]));
  const out = [];
  for (const q of pop) {
    const pos = q.position;
    if (pos == null || pos < 11 || pos > 30) continue;
    const url = urlByQuery.get(String(q.query).toLowerCase());
    if (!url || !fileForUrl(url)) continue;
    out.push({ query: q.query, url, position: pos, impressions: imprByQuery.get(String(q.query).toLowerCase()) || q.shows || 0 });
  }
  return out.sort((a, b) => b.impressions - a.impressions);
}

/** Каннибализация по контенту: пары страниц, делящие ≥2 ключевых фразы (конкурируют за один запрос). */
export function keywordCannibalization(pages, { minShared = 2 } = {}) {
  const norm = (s) => String(s).toLowerCase().trim();
  const list = (pages || existingPages()).map((p) => ({ url: p.url, kw: new Set((p.keywords || []).map(norm)) }));
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const shared = [...list[i].kw].filter((k) => k.length > 6 && list[j].kw.has(k));
      if (shared.length >= minShared) out.push({ a: list[i].url, b: list[j].url, shared });
    }
  }
  return out.sort((x, y) => y.shared.length - x.shared.length);
}

/** Кандидаты на рефреш по поведенческому сигналу Метрики: визиты есть, отказы высокие. */
export function bounceCandidates(landing, { minVisits = 5, minBounce = 65 } = {}) {
  return (landing || [])
    .filter((p) => p.visits >= minVisits && p.bounce >= minBounce && fileForUrl(p.path))
    .sort((a, b) => b.bounce - a.bounce)
    .map((p) => ({ url: p.path, query: null, position: null, bounce: p.bounce, visits: p.visits }));
}

const REFRESH_SYS =
  'Ты эксперт-бухгалтер и автор. Пишешь один новый раздел статьи на русском для читателя из РФ, 2026 год. ' +
  'Только чистый Markdown: один заголовок «## …» и 2–4 абзаца (180–260 слов). Без вводных «в этой статье», ' +
  'без ссылок и картинок, без повторения уже раскрытых мыслей. Конкретика, цифры, актуальные правила 2026.';

/** Дописать один свежий раздел в застрявшую страницу и обновить дату. */
export async function refreshPage(cand, { minDays = 14 } = {}) {
  const file = fileForUrl(cand.url);
  if (!file) return null;
  const logObj = loadRefreshLog();
  const last = logObj[cand.url];
  if (last && (Date.now() - new Date(last).getTime()) / 864e5 < minDays) return null; // недавно освежали

  const raw = readFileSync(file, 'utf-8');
  const m = raw.match(/^(---\n[\s\S]*?\n---\n)([\s\S]*)$/);
  if (!m) return null;
  let [, fm, body] = m;
  const headings = [...body.matchAll(/^##\s+(.+)$/gm)].map((x) => x[1].trim());
  const title = (fm.match(/^title:\s*(.+)$/m)?.[1] || '').replace(/^["']|["']$/g, '');

  const focus = cand.query
    ? `Запрос, по которому страница застряла на позиции ${cand.position}: «${cand.query}».`
    : `Тема страницы «${title}» даёт высокий процент отказов (${Math.round(cand.bounce || 0)}%) — читателю не хватает глубины/пользы.`;
  const user =
    `${focus}\nURL: ${cand.url}\nУже есть разделы: ${headings.join('; ') || '—'}.\n` +
    `Напиши ОДИН новый раздел, углубляющий тему (практика, цифры, примеры 2026), которого ещё нет выше.`;
  let section;
  try { section = (await ask(REFRESH_SYS, user, { maxTokens: 900, temperature: 0.75 })).trim(); }
  catch { return null; }
  if (!/^##\s+/m.test(section) || section.length < 300) return null;

  // вставить перед завершающим блоком (FAQ/Заключение), иначе в конец тела
  const tailRe = /\n##\s+(?:Часто задаваемые|Вопросы|FAQ|Заключени|Итоги|Вывод|С чего начать|Как начать|Готовы|Оставьте|Свяжитесь|Записаться|Заказать)/i;
  const tail = body.search(tailRe);
  if (tail > -1) body = body.slice(0, tail) + '\n\n' + section + '\n' + body.slice(tail);
  else body = body.replace(/\s*$/, '') + '\n\n' + section + '\n';

  // обновить дату updated во frontmatter
  if (/^updated:.*$/m.test(fm)) fm = fm.replace(/^updated:.*$/m, `updated: ${today()}`);
  else fm = fm.replace(/^(title:.*)$/m, `$1\nupdated: ${today()}`);

  writeFileSync(file, fm + body, 'utf-8');
  logObj[cand.url] = today();
  saveRefreshLog(logObj);
  return { url: cand.url, query: cand.query, position: cand.position };
}

// ── Форматирование блока «здоровье» для отчёта ────────
export function formatHealth(h, extra = {}) {
  const lines = [];
  const s = h.summary;
  if (s) lines.push(`ИКС: ${s.sqi} · в поиске: ${s.searchable} · исключено: ${s.excluded}`);
  if (h.events?.removedRecently) lines.push(`⚠️ выпало из поиска: ${h.events.removed}`);
  if (h.crawlErrors?.length) lines.push(`🧨 ошибки обхода (4xx/5xx): ${h.crawlErrors.length}`);
  if (h.broken?.count) lines.push(`🔗 битых внутренних ссылок: ${h.broken.count}`);
  if (typeof h.extCount === 'number' && h.extCount > 0) lines.push(`🌐 внешних ссылок: ${h.extCount}`);
  const active = (h.diag || []).filter((d) => !DIAG_IGNORE.has(d.key) && (d.severity !== 'RECOMMENDATION' || d.key.includes('4XX') || d.key.includes('5XX')));
  if (active.length) lines.push('🩺 ' + active.map((d) => diagLabel(d.key)).join(', '));
  if (extra.recrawled?.length) lines.push(`♻️ на переобход: ${extra.recrawled.length}`);
  if (extra.refreshed?.length) lines.push('🔄 обновлены (рефреш): ' + extra.refreshed.map((r) => r.query).join('; '));
  return lines;
}
