// Стоп-лист: бренды-конкуренты и чужая гео. Гейт публикации — агент НЕ пишет и НЕ публикует про них.
// Настраивается разделом `blocklist` в site.profile.mjs. Матчинг брендов точный, чтобы не задеть
// омонимы: слово «этажи» в смысле этажности дома НЕ должно триггерить бренд-агентство «Этажи».
import { PROFILE } from '../../../site.profile.mjs';

// Заголовочные зоны (frontmatter title/seoTitle + H1/H2/H3) — там имя темы, а не проза.
function titleZones(mdx) {
  const out = [];
  const fm = mdx.match(/^---[\s\S]*?---/);
  if (fm) for (const m of fm[0].matchAll(/^\s*(?:seoTitle|title)\s*:\s*["']?(.+?)["']?\s*$/gim)) out.push(m[1]);
  for (const m of mdx.matchAll(/^#{1,3}\s+(.+)$/gm)) out.push(m[1]);
  return out.join('  ');
}

// Причина блокировки (строка) или null, если публиковать можно.
export function blockReason(mdx, slug = '') {
  const bl = PROFILE.blocklist;
  if (!bl) return null;
  const zones = slug + '  ' + titleZones(mdx);
  const zonesLow = zones.toLowerCase();
  const bodyLow = String(mdx).toLowerCase();

  // 1) Латинские/доменные формы бренда где угодно (этажность никогда не пишется латиницей).
  for (const p of (bl.brandLatin || [])) {
    if (bodyLow.includes(p.toLowerCase())) return `бренд-конкурент (латиница): ${p}`;
  }
  // 2) Кириллический бренд с заглавной — только в заголовках/слаге (в прозе можно «этажи»=этажность).
  for (const p of (bl.brandTitle || [])) {
    if (new RegExp(`(^|[^а-яёА-ЯЁ])${p}([^а-яёА-ЯЁ]|$)`).test(zones)) return `бренд-конкурент в заголовке: ${p}`;
  }
  // 3) Кириллический бренд в кавычках/агентском контексте — где угодно в теле.
  for (const re of (bl.brandBodyRe || [])) {
    try { if (new RegExp(re, 'i').test(mdx)) return `бренд-конкурент в тексте: /${re}/`; } catch {}
  }
  // 4) Чужой город в заголовке/слаге (в теле для сравнения цен — допустимо, не триггерим).
  for (const city of (bl.denyCities || [])) {
    if (zonesLow.includes(city.toLowerCase())) return `чужой город в заголовке: ${city}`;
  }
  return null;
}

// Префильтр ключей/тем ДО генерации — чтобы не тратить API на заведомо блокируемое.
export function isBlockedKeyword(keyword = '') {
  const bl = PROFILE.blocklist;
  if (!bl) return false;
  const k = String(keyword).toLowerCase();
  for (const p of (bl.brandLatin || [])) if (k.includes(p.toLowerCase())) return true;
  for (const p of (bl.brandTitle || [])) if (new RegExp(`(^|[^а-яёА-ЯЁ])${p}([^а-яёА-ЯЁ]|$)`, 'i').test(keyword)) return true;
  for (const city of (bl.denyCities || [])) if (k.includes(city.toLowerCase())) return true;
  return false;
}
