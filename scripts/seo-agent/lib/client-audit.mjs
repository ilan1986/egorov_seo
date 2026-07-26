// Внешний аудит КЛИЕНТСКОГО сайта (агентский режим) — без доступа к его токенам: краулит публичные
// страницы и считает SEO+GEO-сигналы детерминированно. На выходе — единый объект для отчёта и КП.
// Переиспользует citability (цитируемость), snapshotHtml (schema/title/h1), проверки robots/llms.txt.
import { scoreCitability } from './citability.mjs';
import { snapshotHtml } from './drift.mjs';
import { compositeGeoScore } from './geo-score.mjs';
import { detectLocal, localChecks } from './local.mjs';
import { detectShop, ecommerceChecks } from './ecommerce.mjs';

const norm = (u) => u.replace(/\/$/, '');
const textFromHtml = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function get(url, timeoutMs = 15000) {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'Mozilla/5.0 egorov-seo-audit' } });
    return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : '', ctype: r.headers.get('content-type') || '' };
  } catch (e) { return { ok: false, status: 0, text: '', err: e.message }; }
}

async function pageUrls(base) {
  // берём до 6 URL из sitemap, иначе — только главную
  for (const sm of ['/sitemap-index.xml', '/sitemap.xml']) {
    const r = await get(base + sm, 10000);
    if (r.ok && /<loc>/.test(r.text)) {
      const locs = [...r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
      const pages = locs.filter((u) => !/\.xml$/i.test(u));
      if (pages.length) return [base + '/', ...pages.filter((u) => u !== base + '/').slice(0, 5)];
      if (locs.length) { // sitemap-index → тянем первый вложенный
        const sub = await get(locs[0], 10000);
        const subLocs = [...sub.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
        return [base + '/', ...subLocs.slice(0, 5)];
      }
    }
  }
  return [base + '/'];
}

/**
 * @param {string} url — клиентский сайт
 * @param {object} [opts] { deep=false, maxPages=40 } — deep: обойти весь сайт через Crawlee
 *   (JS-рендер SPA + битые ссылки), иначе — до 6 URL из sitemap (быстро).
 * @returns {Promise<object>} аудит: score, categories, findings[], pages[]
 */
export async function auditClientSite(url, { deep = false, maxPages = 40 } = {}) {
  const base = norm(/^https?:/.test(url) ? url : 'https://' + url);
  const findings = [];
  const add = (sev, cat, msg) => findings.push({ sev, cat, msg });

  // robots.txt — доступ AI-ботов
  const robots = await get(base + '/robots.txt', 8000);
  const aiBots = ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'YandexAdditional'];
  let aiBlocked = 0;
  if (robots.ok) { for (const b of aiBots) if (new RegExp(`User-agent:\\s*${b}[\\s\\S]{0,200}?Disallow:\\s*/\\s`, 'i').test(robots.text)) aiBlocked++; }
  if (aiBlocked >= 3) add('critical', 'geo', `Заблокированы AI-краулеры (${aiBlocked}) в robots.txt — сайт невидим для нейросетей`);

  // llms.txt
  const llms = await get(base + '/llms.txt', 8000);
  const hasLlms = llms.ok && llms.text.trim().startsWith('#');
  if (!hasLlms) add('medium', 'geo', 'Нет llms.txt — карта сайта для нейросетей отсутствует');

  const pages = [];
  let citSum = 0, schemaPages = 0, thinPages = 0, homeHtml = '';
  let crawl = null;

  if (deep) {
    // Глубокий обход всего сайта (Crawlee): все страницы + битые ссылки + детект SPA
    const { deepCrawl } = await import('./deepcrawl.mjs');
    crawl = await deepCrawl(base, { maxPages });
    const hr = await get(base + '/', 12000); homeHtml = hr.text || '';
    if (crawl.spa) add('critical', 'geo', 'Сайт рендерится на клиенте (SPA/JS) — без выполнения JS контент не виден; риск для индексации Яндексом и невидимость для части нейросетей');
    for (const p of crawl.pages) {
      citSum += p.citability;
      if (p.schema.length) schemaPages++;
      if (p.words < 600) thinPages++;
      pages.push({ url: p.url, title: p.title, words: p.words, citability: p.citability, schema: p.schema, h1: p.h1count, hasDesc: p.hasDesc });
      if (!p.title) add('high', 'seo', `Нет <title>: ${p.url}`);
      if (p.h1count !== 1) add('medium', 'seo', `H1 не единственный (${p.h1count}): ${p.url}`);
    }
    if (crawl.brokenLinks.length) add('high', 'seo', `Битые внутренние ссылки (${crawl.brokenLinks.length}): ${crawl.brokenLinks.slice(0, 4).map((b) => b.url).join(', ')}${crawl.brokenLinks.length > 4 ? '…' : ''}`);
  } else {
    // Быстрый режим: до 6 URL из sitemap
    const urls = await pageUrls(base);
    for (const u of urls) {
      const r = await get(u, 12000);
      if (!r.ok || !/text\/html/i.test(r.ctype)) continue;
      if (!homeHtml) homeHtml = r.text;
      const snap = snapshotHtml(r.text);
      const text = textFromHtml(r.text);
      const words = (text.match(/[А-Яа-яЁёA-Za-z0-9]+/g) || []).length;
      const cit = scoreCitability(text).score;
      citSum += cit;
      if (snap.schemaTypes.length) schemaPages++;
      if (words < 600) thinPages++;
      pages.push({ url: u, title: snap.title, words, citability: cit, schema: snap.schemaTypes, h1: snap.h1count, hasDesc: !!snap.description });
      if (!snap.title) add('high', 'seo', `Нет <title>: ${u}`);
      if (!snap.description) add('medium', 'seo', `Нет meta description: ${u}`);
      if (snap.h1count !== 1) add('medium', 'seo', `H1 не единственный (${snap.h1count}): ${u}`);
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  const n = pages.length || 1;
  const avgCit = Math.round(citSum / n);
  const schemaScore = Math.round((schemaPages / n) * 100);
  if (schemaScore < 50) add('high', 'geo', `Мало страниц со Schema-разметкой (${schemaScore}%) — слабое машинное доверие`);
  if (avgCit < 55) add('high', 'geo', `Низкая цитируемость (${avgCit}/100) — контент неудобно вырезать в ответ ИИ`);
  if (thinPages) add('medium', 'seo', `Тонких страниц (<600 слов): ${thinPages}`);

  // Тип бизнеса → доп. проверки (агентский режим): local / ecommerce
  let businessType = 'content';
  const shop = detectShop(homeHtml, base);
  const loc = detectLocal(homeHtml);
  if (shop.isShop) { businessType = 'shop'; for (const f of ecommerceChecks(homeHtml, base)) add(f.sev, f.cat, f.msg); }
  else if (loc.isLocal) { businessType = 'local'; for (const f of localChecks(homeHtml)) add(f.sev, f.cat, f.msg); }

  const geo = compositeGeoScore({ citability: avgCit, schema: schemaScore, technical: aiBlocked >= 3 ? 30 : 80, eeat: null });
  const seoScore = Math.round((Math.min(100, schemaScore) * 0.2 + avgCit * 0.3 + (pages.every((p) => p.title) ? 100 : 60) * 0.5));

  findings.sort((a, b) => ({ critical: 0, high: 1, medium: 2, low: 3 }[a.sev] - { critical: 0, high: 1, medium: 2, low: 3 }[b.sev]));
  return {
    url: base, checkedAt: new Date().toISOString().slice(0, 10), businessType,
    scores: { overall: Math.round((seoScore + (geo.score ?? avgCit)) / 2), seo: seoScore, geo: geo.score ?? avgCit, citability: avgCit, schema: schemaScore },
    signals: { aiBlocked, hasLlms, pagesChecked: pages.length, schemaPages, thinPages, businessType },
    findings, pages,
    quickWins: findings.filter((f) => f.sev === 'critical' || f.sev === 'high').slice(0, 5).map((f) => f.msg),
  };
}
