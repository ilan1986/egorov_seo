// Гейты качества контента: тонкие/дорвейные/дублирующиеся страницы. Детерминированно, БЕЗ API.
// Пороги адаптированы из claude-seo references/quality-gates.md под РФ-контент-стек.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

// Мин. слов по типу страницы (адаптировано; blog ниже 1500 — у нас гибкий порог 1300).
const WORD_MIN = { home: 400, service: 700, location: 500, blog: 1300, catalog: 400, category: 350, landing: 500, faq: 600, default: 500 };

const TOKEN = /[а-яёa-zA-Z0-9]+/g;
export function wordCount(text) {
  const t = String(text || '').toLowerCase().match(TOKEN);
  return t ? t.length : 0;
}
function norm(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
}
function shingles(text, k = 4) {
  const w = norm(text).split(' ').filter(Boolean);
  const set = new Set();
  for (let i = 0; i + k <= w.length; i++) set.add(w.slice(i, i + k).join(' '));
  return set;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; const [s, l] = a.size < b.size ? [a, b] : [b, a];
  for (const x of s) if (l.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
}

/** Тонкая ли страница по объёму. */
export function checkThin(text, type = 'default') {
  const words = wordCount(text); const min = WORD_MIN[type] ?? WORD_MIN.default;
  return { words, min, thin: words < min };
}
/** Near-duplicate между страницами. pages=[{id,text}]. Пары similarity>=thr + список near-dup id. */
export function duplicationScan(pages, thr = 0.82) {
  const shs = pages.map((p) => ({ id: p.id, sh: shingles(p.text) }));
  const dupPairs = []; const maxSim = {};
  for (let i = 0; i < shs.length; i++) for (let j = i + 1; j < shs.length; j++) {
    const s = jaccard(shs[i].sh, shs[j].sh);
    if (s >= thr) dupPairs.push({ a: shs[i].id, b: shs[j].id, sim: +s.toFixed(2) });
    if (s > (maxSim[shs[i].id] || 0)) maxSim[shs[i].id] = s;
    if (s > (maxSim[shs[j].id] || 0)) maxSim[shs[j].id] = s;
  }
  return { dupPairs: dupPairs.sort((a, b) => b.sim - a.sim), nearDup: pages.filter((p) => (maxSim[p.id] || 0) >= thr).map((p) => p.id) };
}
/** Дорвейный гейт: groups={ключ-модели: кол-во}. Warn 30+, Stop 50+. */
export function doorwayGate(groups) {
  const risks = [];
  for (const [key, count] of Object.entries(groups)) {
    if (count >= 50) risks.push({ key, count, level: 'stop' });
    else if (count >= 30) risks.push({ key, count, level: 'warn' });
  }
  return risks.sort((a, b) => b.count - a.count);
}
/** Комплексный аудит. items=[{id,text,type,group}]. */
export function auditQuality(items, { dupThr = 0.82 } = {}) {
  const thin = items.filter((it) => checkThin(it.text, it.type).thin).map((it) => it.id);
  const { nearDup, dupPairs } = duplicationScan(items.map((it) => ({ id: it.id, text: it.text })), dupThr);
  const groups = {};
  for (const it of items) if (it.group) groups[it.group] = (groups[it.group] || 0) + 1;
  return { total: items.length, thin, nearDup, dupPairs: dupPairs.slice(0, 8), doorway: doorwayGate(groups) };
}

// ── Универсальный аудит по dist/ (HTML) — работает на любом сайте без знания коллекций ──
function htmlText(html) {
  const main = (html.match(/<main[\s\S]*?<\/main>/i) || [html])[0];
  return main.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
}
function typeOf(url) {
  if (url === '/' ) return 'home';
  if (/^\/(blog|stati|servisy|articles)\//.test(url)) return 'blog';
  if (/(kalkulyator|sravnenie|kontakty|ekspert|about|o-|politika)/.test(url)) return 'landing';
  if (url.split('/').filter(Boolean).length >= 3) return 'catalog'; // city/niche/slug
  return 'default';
}
function groupOf(url) {
  const seg = url.split('/').filter(Boolean);
  if (seg.length >= 3) return seg[seg.length - 2]; // ниша/категория для дорвей-детекта
  if (/^\/(blog|stati)\//.test(url)) return 'blog';
  return seg[0] || 'root';
}
export function auditQualityFromDist(distDir) {
  if (!existsSync(distDir)) return null;
  const files = [];
  (function w(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) w(p); else if (e.name === 'index.html' || (e.name.endsWith('.html') && !/404/.test(e.name))) files.push(p); } })(distDir);
  const items = files.map((f) => {
    const url = '/' + relative(distDir, f).replace(/\\/g, '/').replace(/index\.html$/, '');
    if (/404|politika/.test(url)) return null;
    return { id: url.startsWith('/') ? url : '/' + url, text: htmlText(readFileSync(f, 'utf-8')), type: typeOf('/' + url.replace(/^\/+/, '')), group: groupOf('/' + url.replace(/^\/+/, '')) };
  }).filter(Boolean);
  return auditQuality(items);
}
/** Очередь на обогащение: тонкие делятся на статьи (есть исходный MDX → expand-existing) и
 *  карточки-справочники (JSON, нет MDX → ЖК-обогащение). fileForUrl — из content.mjs (url → файл). */
export function enrichmentQueue(audit, fileForUrl) {
  if (!audit) return { articles: [], cards: [], nearDup: [], doorway: [] };
  const articles = [], cards = [];
  for (const url of audit.thin) {
    let f = null;
    try { f = fileForUrl ? fileForUrl(url) : null; } catch { f = null; }
    if (f) { articles.push({ url, file: f }); continue; }
    // карточка каталога = глубина URL ≥2 (напр. /novostroyki/жк/ или /город/ниша/слаг/);
    // статичные/индексные страницы (/, /ekspert/, /stati/) — глубина ≤1 — в обогащение НЕ берём.
    const depth = url.split('/').filter(Boolean).length;
    if (depth >= 2) cards.push({ url });
  }
  return { generatedAt: new Date().toISOString(), articles, cards, nearDup: audit.nearDup, doorway: audit.doorway };
}

export function qualityReportLine(a) {
  if (!a) return null;
  const bits = [`страниц ${a.total}`, `тонких ${a.thin.length}`, `похожих ${a.nearDup.length}`];
  const stop = a.doorway.filter((d) => d.level === 'stop'), warn = a.doorway.filter((d) => d.level === 'warn');
  if (stop.length) bits.push('🛑 дорвей-риск: ' + stop.map((d) => `${d.key}(${d.count})`).join(', '));
  else if (warn.length) bits.push('⚠️ следить: ' + warn.map((d) => `${d.key}(${d.count})`).join(', '));
  return 'Качество контента: ' + bits.join(' · ');
}
