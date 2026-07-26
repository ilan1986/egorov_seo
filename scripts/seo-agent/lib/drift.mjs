// SEO-drift монитор: снапшот критичных SEO-элементов страниц из собранного dist/ и диф против
// прошлого снапшота. Ловит именно те грабли из SKILL.md — «Astro молча не собрал страницу /
// потерял schema / scoped-стили / canonical после правки ядра». Детерминированно, без внешних API.
// Вызывать в конце деплоя; регрессии — в daily-report/Telegram.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR } from '../config.mjs';

const DRIFT_DIR = join(ROOT_DIR, 'scripts/seo-agent/data/drift');
const SNAP = join(DRIFT_DIR, 'snapshot.json');

const pick = (re, html) => (html.match(re)?.[1] || '').trim();

/** Извлечь SEO-элементы из HTML одной страницы. */
export function snapshotHtml(html) {
  const schemas = [];
  const re = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const j = JSON.parse(m[1]);
      const nodes = j['@graph'] || [j];
      for (const n of nodes) if (n && n['@type']) schemas.push(...[].concat(n['@type']));
    } catch { schemas.push('INVALID_JSONLD'); }
  }
  const h1 = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((x) => x[1].replace(/<[^>]+>/g, '').trim());
  return {
    title: pick(/<title[^>]*>([\s\S]*?)<\/title>/i, html),
    description: pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i, html),
    canonical: pick(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i, html),
    robots: pick(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i, html),
    ogTitle: pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i, html),
    ogImage: pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i, html),
    h1: h1,
    h1count: h1.length,
    schemaTypes: [...new Set(schemas)].sort(),
    bytes: html.length,
    hasStyle: /<style/i.test(html),
  };
}

/** Пройти dist/, собрать снапшот по всем index.html. */
export function snapshotDist(distDir = join(ROOT_DIR, 'dist')) {
  const out = {};
  const walk = (d, base = '') => {
    let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory()) walk(join(d, e.name), `${base}/${e.name}`);
      else if (e.name === 'index.html') {
        const url = (base || '/') + '/';
        try { out[url.replace(/\/+/g, '/')] = snapshotHtml(readFileSync(join(d, e.name), 'utf-8')); } catch {}
      }
    }
  };
  walk(distDir);
  return out;
}

/** Сравнить текущий снапшот с прошлым → список регрессий. */
export function diffSnapshots(prev, cur) {
  const reg = [];
  for (const [url, p] of Object.entries(prev)) {
    const c = cur[url];
    if (!c) { reg.push({ url, sev: 'critical', issue: 'страница ИСЧЕЗЛА из сборки (была, стало 404)' }); continue; }
    if (p.title && !c.title) reg.push({ url, sev: 'high', issue: 'пропал <title>' });
    if (p.canonical && !c.canonical) reg.push({ url, sev: 'high', issue: 'пропал canonical' });
    if (!p.robots.includes('noindex') && c.robots.includes('noindex')) reg.push({ url, sev: 'critical', issue: 'появился noindex' });
    if (p.schemaTypes.length > c.schemaTypes.length) reg.push({ url, sev: 'high', issue: `пропала schema (${p.schemaTypes.filter((t) => !c.schemaTypes.includes(t)).join(',')})` });
    if (c.schemaTypes.includes('INVALID_JSONLD')) reg.push({ url, sev: 'high', issue: 'битый JSON-LD' });
    if (p.h1count === 1 && c.h1count !== 1) reg.push({ url, sev: 'medium', issue: `H1 было 1, стало ${c.h1count}` });
    if (p.description && !c.description) reg.push({ url, sev: 'medium', issue: 'пропал meta description' });
    if (p.bytes > 2000 && c.bytes < p.bytes * 0.5) reg.push({ url, sev: 'medium', issue: `объём страницы упал вдвое (${p.bytes}→${c.bytes})` });
  }
  const added = Object.keys(cur).filter((u) => !prev[u]);
  return { regressions: reg, added: added.length, removed: reg.filter((r) => r.issue.includes('ИСЧЕЗЛА')).length };
}

/** Полный прогон: снять снапшот, сравнить с сохранённым, перезаписать. @returns diff */
export function runDrift(distDir) {
  const cur = snapshotDist(distDir);
  let prev = {};
  try { prev = existsSync(SNAP) ? JSON.parse(readFileSync(SNAP, 'utf-8')) : {}; } catch {}
  const diff = Object.keys(prev).length ? diffSnapshots(prev, cur) : { regressions: [], added: Object.keys(cur).length, removed: 0, first: true };
  try { mkdirSync(DRIFT_DIR, { recursive: true }); writeFileSync(SNAP, JSON.stringify(cur), 'utf-8'); } catch {}
  return diff;
}

export function driftReportLine(diff) {
  if (diff.first) return `🧭 Drift: первый снапшот (${diff.added} страниц), сравнивать не с чем.`;
  const crit = diff.regressions.filter((r) => r.sev === 'critical').length;
  if (!diff.regressions.length) return `🧭 Drift: ок, регрессий нет (+${diff.added} новых).`;
  const top = diff.regressions.slice(0, 5).map((r) => `${r.sev === 'critical' ? '🛑' : '⚠️'} ${r.url}: ${r.issue}`).join('\n   ');
  return `🧭 Drift: ${diff.regressions.length} регрессий${crit ? ` (${crit} критич.)` : ''}:\n   ${top}`;
}

// CLI: node scripts/seo-agent/lib/drift.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(driftReportLine(runDrift()));
}
