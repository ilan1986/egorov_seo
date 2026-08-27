// Мониторинг ссылочного профиля из БЕСПЛАТНЫХ источников (без Ahrefs — дорого для бюджета $1/день).
// Источники (все опциональны, работают независимо — что настроено, то и опрашиваем):
//   • OpenPageRank — авторитет домена 0..10 (нужен бесплатный ключ OPR_API_KEY; уже используется в drop-hunter).
//   • Common Crawl — упоминания домена в вебграфе (публичный индекс, без ключа).
//   • Moz Links API — DA/PA/ref-domains (бесплатный тир 10 запросов/мес; MOZ_TOKEN, опционально).
// Ничего платного и никакого обхода защит. Результат — снимок + дельта к прошлому запуску (растёт/падает ссылочное).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG, ROOT_DIR, DEFAULT_HEADERS } from '../config.mjs';

const DATA = join(ROOT_DIR, 'scripts/seo-agent/data');
const OUT = join(DATA, 'backlinks.json');
const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u).replace(/^www\./, ''); } };

const OPR_KEY = process.env.OPR_API_KEY || '';
const MOZ_TOKEN = process.env.MOZ_TOKEN || '';

/** OpenPageRank: авторитет домена 0..10 (0 = нет данных/новый). */
async function oprRank(domain) {
  if (!OPR_KEY) return null;
  try {
    const r = await fetch(`https://openpagerank.com/api/v1.0/getPageRank?domains[]=${encodeURIComponent(domain)}`, {
      headers: { 'API-OPR': OPR_KEY }, signal: AbortSignal.timeout(15000),
    });
    const j = await r.json();
    const row = j?.response?.[0];
    return row && row.status_code === 200 ? { rank: Number(row.page_rank_decimal) || 0 } : null;
  } catch { return null; }
}

/** Common Crawl: сколько РАЗНЫХ доменов-источников ссылаются/упоминают наш (грубая оценка по последнему индексу). */
async function commonCrawlRefs(domain, { index = 'CC-MAIN-2024-51' } = {}) {
  try {
    const r = await fetch(`https://index.commoncrawl.org/${index}-index?url=*.${encodeURIComponent(domain)}&output=json&limit=200`, {
      headers: DEFAULT_HEADERS, signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) return null;
    const text = await r.text();
    const hosts = new Set();
    for (const line of text.trim().split('\n')) {
      try { const j = JSON.parse(line); if (j.url) hosts.add(domainOf(j.url)); } catch {}
    }
    hosts.delete(domain);
    return { referringDomains: hosts.size, sample: [...hosts].slice(0, 15) };
  } catch { return null; }
}

/** Moz Links API (бесплатный тир) — DA/PA + число ссылающихся доменов. Опционально. */
async function mozMetrics(domain) {
  if (!MOZ_TOKEN) return null;
  try {
    const r = await fetch('https://lsapi.seomoz.com/v2/url_metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MOZ_TOKEN}` },
      body: JSON.stringify({ targets: [domain] }), signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const m = j?.results?.[0];
    return m ? { da: m.domain_authority, pa: m.page_authority, refDomains: m.root_domains_to_root_domain } : null;
  } catch { return null; }
}

/** Снимок ссылочного профиля из всех доступных бесплатных источников + дельта к прошлому запуску. */
export async function backlinksSnapshot(siteUrl = CONFIG.siteUrl) {
  const domain = domainOf(siteUrl);
  const [opr, cc, moz] = await Promise.all([oprRank(domain), commonCrawlRefs(domain), mozMetrics(domain)]);
  const snap = {
    date: new Date().toISOString().slice(0, 10),
    domain,
    authority: opr?.rank ?? moz?.da ?? null,          // 0..10 (OPR) или 0..100 (Moz DA)
    authoritySource: opr ? 'OpenPageRank(0-10)' : moz ? 'Moz DA(0-100)' : null,
    referringDomains: moz?.refDomains ?? cc?.referringDomains ?? null,
    sample: cc?.sample ?? [],
    sources: { openPageRank: !!opr, commonCrawl: !!cc, moz: !!moz },
  };
  // дельта
  let prev = null;
  try { prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf-8')) : null; } catch {}
  if (prev?.latest) {
    snap.delta = {
      authority: snap.authority != null && prev.latest.authority != null ? +(snap.authority - prev.latest.authority).toFixed(2) : null,
      referringDomains: snap.referringDomains != null && prev.latest.referringDomains != null ? snap.referringDomains - prev.latest.referringDomains : null,
    };
  }
  try {
    mkdirSync(DATA, { recursive: true });
    const hist = prev || { history: [] };
    hist.history = (hist.history || []).slice(-24);
    hist.history.push({ date: snap.date, authority: snap.authority, referringDomains: snap.referringDomains });
    hist.latest = snap;
    writeFileSync(OUT, JSON.stringify(hist, null, 2), 'utf-8');
  } catch {}
  return snap;
}

/**
 * План аутрича: из тематики/ниши профиля — приоритетные ТИПЫ доноров и заготовки под ручную работу.
 * НЕ рассылает ничего сам (аутрич = risk:approve). Даёт человеку готовый список направлений.
 */
export function outreachPlan(profile) {
  const niche = profile?.niche || profile?.brand?.niche || 'услуги';
  const city = profile?.geo?.city || '';
  return {
    priorities: [
      { type: 'Отраслевые каталоги/справочники', why: 'быстрые тематические ссылки + трафик', example: `каталоги по нише «${niche}»${city ? `, ${city}` : ''}` },
      { type: 'Гостевые статьи на профильных площадках', why: 'ссылка в контексте = сильный сигнал E-E-A-T', example: 'блоги/СМИ по теме, где пишет эксперт проекта' },
      { type: 'Локальные площадки/агрегаторы', why: 'гео-релевантность для Яндекса', example: city ? `городские порталы ${city}` : 'региональные порталы' },
      { type: 'Упоминания без ссылки → попросить ссылку', why: 'самый дешёвый линкбилдинг', example: 'найти упоминания бренда в Common Crawl/поиске и запросить гиперссылку' },
      { type: 'Экспертные комментарии (HARO-аналоги РФ: Pressfeed)', why: 'ссылки из СМИ под авторитет автора', example: 'ответы журналистам от лица эксперта' },
    ],
    note: 'Аутрич — только через /approve. Агент готовит список и черновики писем, отправляет человек.',
  };
}

// CLI: node scripts/seo-agent/lib/backlinks.mjs
import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  backlinksSnapshot().then((s) => {
    console.log(`Ссылочное ${s.domain}: авторитет ${s.authority ?? '—'} (${s.authoritySource ?? 'нет источника'}), ` +
      `ссылающихся доменов ${s.referringDomains ?? '—'}`);
    if (!s.sources.openPageRank && !s.sources.commonCrawl && !s.sources.moz)
      console.log('Ни один источник не настроен: задай OPR_API_KEY (бесплатно) и/или MOZ_TOKEN. Common Crawl работает без ключа.');
    if (s.sample?.length) console.log('Примеры доноров:', s.sample.join(', '));
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
