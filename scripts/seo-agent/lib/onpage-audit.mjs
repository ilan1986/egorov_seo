// Технический on-page аудит собранного dist/ (перед деплоем). Детерминированно, без API.
// Из claude-seo seo-technical (9 категорий) — адаптировано под статический Astro-билд.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

function walkHtml(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  (function w(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) w(p); else if (e.name.endsWith('.html')) out.push(p); } })(dir);
  return out;
}
const grab = (html, re) => { const m = html.match(re); return m ? m[1].trim() : null; };

export function auditDist(distDir) {
  const files = walkHtml(distDir);
  const urlOf = (f) => '/' + relative(distDir, f).replace(/\\/g, '/').replace(/index\.html$/, '').replace(/\.html$/, '/');
  const allUrls = new Set(files.map(urlOf));
  const issues = [];
  for (const f of files) {
    const html = readFileSync(f, 'utf-8'); const url = urlOf(f);
    const isSys = /404|politika-konfiden/.test(url);
    const title = grab(html, /<title>([^<]*)<\/title>/i);
    const desc = grab(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
    const h1 = (html.match(/<h1[\s>]/gi) || []).length;
    const canonical = /<link[^>]+rel=["']canonical["']/i.test(html);
    const noindex = /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html);
    const jsonld = /<script[^>]+application\/ld\+json/i.test(html);
    const imgs = html.match(/<img\b[^>]*>/gi) || [];
    const imgNoAlt = imgs.filter((i) => !/\balt\s*=/.test(i)).length;
    if (!title) issues.push({ sev: 'crit', url, msg: 'нет <title>' });
    else if (title.length > 65) issues.push({ sev: 'warn', url, msg: `title ${title.length}>60` });
    if (!isSys && !desc) issues.push({ sev: 'warn', url, msg: 'нет meta description' });
    else if (desc && desc.length > 175) issues.push({ sev: 'warn', url, msg: `description ${desc.length}>165` });
    if (h1 === 0 && !isSys) issues.push({ sev: 'crit', url, msg: 'нет H1' });
    else if (h1 > 1) issues.push({ sev: 'warn', url, msg: `H1 ×${h1}` });
    if (!canonical && !isSys) issues.push({ sev: 'warn', url, msg: 'нет canonical' });
    if (noindex && !isSys) issues.push({ sev: 'crit', url, msg: 'noindex на боевой странице' });
    if (!jsonld && !isSys && url.split('/').filter(Boolean).length >= 1) issues.push({ sev: 'warn', url, msg: 'нет JSON-LD schema' });
    if (imgNoAlt) issues.push({ sev: 'warn', url, msg: `${imgNoAlt} <img> без alt` });
    // битые внутренние ссылки
    const seen = new Set();
    for (const m of html.matchAll(/href=["'](\/[^"'#?]*)["']/gi)) {
      const raw = m[1]; if (seen.has(raw)) continue; seen.add(raw);
      if (/\.(jpg|jpeg|png|svg|webp|gif|css|js|xml|txt|ico|pdf|json|woff2?)$/i.test(raw)) continue;
      let h = raw.endsWith('/') || /\.\w+$/.test(raw) ? raw : raw + '/';
      const fileGuess = join(distDir, raw.replace(/^\//, ''));
      if (!allUrls.has(h) && !existsSync(fileGuess) && !existsSync(join(distDir, h.replace(/^\//, ''), 'index.html'))) {
        issues.push({ sev: 'warn', url, msg: `битая внутр. ссылка ${raw}` });
      }
    }
  }
  const critical = issues.filter((i) => i.sev === 'crit').length;
  return { pages: files.length, issues, critical, warnings: issues.length - critical };
}
export function onpageReportLine(a) {
  if (!a) return null;
  return `Тех-аудит dist: ${a.pages} стр · критично ${a.critical} · предупреждений ${a.warnings}`;
}
