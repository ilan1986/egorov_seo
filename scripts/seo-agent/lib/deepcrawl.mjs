// Глубокий краулинг сайта на Crawlee: обходит ВЕСЬ сайт по внутренним ссылкам (не 6 из sitemap),
// собирает per-page SEO/GEO-сигналы, ловит битые внутренние ссылки, детектит SPA/JS-рендер.
// Быстрый путь — CheerioCrawler (без браузера). Для JS-сайтов — Playwright (render:'playwright',
// нужен `npx playwright install chromium`); авто-детект SPA подсказывает, когда он нужен.
// Хранилище — in-memory (persistStorage:false), ничего не пишет на диск.
import { scoreCitability } from './citability.mjs';

const textFromHtml = (h) => String(h).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const wordCount = (t) => (t.match(/[А-Яа-яЁёA-Za-z0-9]+/g) || []).length;

/** Похоже ли на клиент-рендер (SPA): пустое тело + маркеры фреймворка. */
export function detectSpa(html) {
  const h = String(html);
  const words = wordCount(textFromHtml(h));
  const shell = /<div[^>]+id=["'](root|app|__next|__nuxt|q-app)["']/i.test(h) || /window\.__(NUXT|NEXT_DATA)__/i.test(h);
  const scripts = (h.match(/<script/gi) || []).length;
  return { spa: words < 250 && (shell || scripts > 8), words, shell, scripts };
}

function schemaTypes(html) {
  const types = new Set();
  for (const m of String(html).matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collectTypes(JSON.parse(m[1].trim()), types); } catch { /* невалидный JSON-LD */ }
  }
  return [...types];
}
function collectTypes(node, set) {
  if (Array.isArray(node)) return node.forEach((n) => collectTypes(n, set));
  if (node && typeof node === 'object') {
    if (node['@type']) [].concat(node['@type']).forEach((t) => set.add(t));
    for (const k of ['@graph', 'mainEntity', 'itemListElement']) if (node[k]) collectTypes(node[k], set);
  }
}

/**
 * @param {string} startUrl
 * @param {object} [opts] { maxPages=40, render='auto'|'cheerio'|'playwright', maxConcurrency=4, sameHostOnly=true }
 * @returns {Promise<object>} { pages[], brokenLinks[], spa, pagesCrawled, engine, host }
 */
export async function deepCrawl(startUrl, opts = {}) {
  const { maxPages = 40, maxConcurrency = 4, sameHostOnly = true } = opts;
  const base = /^https?:/.test(startUrl) ? startUrl : 'https://' + startUrl;
  const host = new URL(base).hostname;
  const { CheerioCrawler, PlaywrightCrawler, Configuration } = await import('crawlee');

  // авто-детект SPA по главной
  let render = opts.render || 'auto';
  let spaInfo = { spa: false };
  if (render === 'auto') {
    try {
      const r = await fetch(base, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'egorov-seo-audit' } });
      spaInfo = detectSpa(await r.text());
      render = spaInfo.spa ? 'playwright' : 'cheerio';
    } catch { render = 'cheerio'; }
  }

  const pages = [];
  const broken = [];
  const seen = new Set();
  const cfg = new Configuration({ persistStorage: false, headless: true });

  const record = (url, status, html) => {
    if (seen.has(url)) return; seen.add(url);
    const text = textFromHtml(html);
    const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1]?.trim() || '';
    const h1count = (html.match(/<h1[\s>]/gi) || []).length;
    const description = (/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html) || [])[1] || '';
    let cit = 0; try { cit = scoreCitability(text).score; } catch { /* ignore */ }
    pages.push({ url, status, title, h1count, description, words: wordCount(text), citability: cit, schema: schemaTypes(html), hasDesc: !!description });
  };

  const common = {
    maxRequestsPerCrawl: maxPages,
    maxConcurrency,
    maxRequestRetries: 1,
    requestHandlerTimeoutSecs: 40,
    failedRequestHandler({ request, response }) {
      const st = response?.statusCode || request?.errorMessages?.length ? (response?.statusCode || 0) : 0;
      broken.push({ url: request.url, status: response?.statusCode || 0, from: request.userData?.from || null });
    },
  };
  const enqOpts = { strategy: sameHostOnly ? 'same-hostname' : 'same-domain', transformRequestFunction: (req) => { req.userData = { from: req.userData?.from }; return req; } };

  let crawler, engine;
  if (render === 'playwright') {
    engine = 'playwright';
    crawler = new PlaywrightCrawler({
      ...common,
      launchContext: { launchOptions: { args: ['--no-sandbox'] } },
      async requestHandler({ request, page, response, enqueueLinks }) {
        const html = await page.content();
        record(request.url, response?.status() || 200, html);
        await enqueueLinks({ ...enqOpts, userData: { from: request.url } });
      },
    }, cfg);
  } else {
    engine = 'cheerio';
    crawler = new CheerioCrawler({
      ...common,
      async requestHandler({ request, body, response, enqueueLinks }) {
        record(request.url, response?.statusCode || 200, body.toString());
        await enqueueLinks({ ...enqOpts, userData: { from: request.url } });
      },
    }, cfg);
  }

  try { await crawler.run([{ url: base, userData: { from: null } }]); }
  finally { try { await crawler.teardown(); } catch {} }

  return {
    host, engine, spa: spaInfo.spa, spaInfo,
    pagesCrawled: pages.length,
    pages,
    brokenLinks: broken.filter((b) => b.status >= 400 || b.status === 0).slice(0, 50),
  };
}
