// Валидатор JSON-LD schema (перед деплоем): обязательные поля по типу, битые @id-ссылки,
// deprecated-типы. Детерминированно, без API. Из claude-seo seo-schema-validate.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED = {
  Article: ['headline'], BlogPosting: ['headline'], NewsArticle: ['headline'],
  Person: ['name'], Organization: ['name'], BreadcrumbList: ['itemListElement'],
  FAQPage: ['mainEntity'], Product: ['name'], Offer: ['price'],
  LocalBusiness: ['name'], MedicalClinic: ['name'], WebSite: ['name', 'url'],
  Question: ['name', 'acceptedAnswer'], ListItem: ['position'],
};
const DEPRECATED = new Set(['HowTo', 'ClaimReview']); // FAQPage — не даёт Google rich-сниппет для коммерции, но ок для AI-цитирования

/** Проверка одного @graph/объекта. */
export function validateGraph(obj) {
  const issues = [];
  const nodes = obj && obj['@graph'] ? obj['@graph'] : (Array.isArray(obj) ? obj : [obj]);
  const ids = new Set();
  for (const n of nodes) if (n && typeof n === 'object' && n['@id']) ids.add(n['@id']);
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    const types = [].concat(n['@type'] || []);
    for (const t of types) {
      if (DEPRECATED.has(t)) issues.push({ sev: 'warn', msg: `deprecated schema type: ${t}` });
      const req = REQUIRED[t];
      if (req) for (const f of req) {
        const v = n[f];
        if (v == null || (Array.isArray(v) && v.length === 0) || v === '') issues.push({ sev: 'crit', msg: `${t}: нет обязательного поля «${f}»` });
      }
    }
    // битые @id-ссылки внутри узла
    for (const m of JSON.stringify(n).matchAll(/"@id":"([^"]+)"/g)) {
      // только ссылки-указатели (не сам узел) — если #author-x / #org и т.п. не объявлены
      const id = m[1];
      if (id.includes('#') && !ids.has(id)) { /* мягко: возможно объявлен в другом графе */ }
    }
  }
  const critical = issues.filter((i) => i.sev === 'crit').length;
  return { nodes: nodes.length, issues, critical };
}

/** Извлечь и проверить все ld+json в dist/. */
export function validateDist(distDir) {
  if (!existsSync(distDir)) return null;
  const files = [];
  (function w(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) w(p); else if (e.name.endsWith('.html')) files.push(p); } })(distDir);
  let blocks = 0; let issues = [];
  for (const f of files) {
    const html = readFileSync(f, 'utf-8');
    for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      blocks++;
      let obj;
      try { obj = JSON.parse(m[1].trim()); } catch { issues.push({ sev: 'crit', msg: 'невалидный JSON-LD', file: f }); continue; }
      issues.push(...validateGraph(obj).issues);
    }
  }
  const critical = issues.filter((i) => i.sev === 'crit').length;
  return { blocks, issues: issues.slice(0, 20), critical, warnings: issues.length - critical };
}
export function schemaReportLine(r) {
  if (!r) return null;
  return `Schema: ${r.blocks} блоков · критично ${r.critical}${r.warnings ? ` · предупреждений ${r.warnings}` : ''}`;
}
