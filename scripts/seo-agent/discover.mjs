// Авто-поиск сайтов-кандидатов в воронку (агентский режим). Источник — база 2ГИС (candidates.json:
// name/url/phone/email/telegram/category/rubric). Лёгкий проб главной → быстрый SEO+GEO-балл →
// ранжирование по «нужде» (ниже балл = сайт слабее = ты нужнее) → топ-N в CRM-воронку с контактом.
// Полный аудит/КП — потом по команде /audit|/kp <url>.
// CLI: node scripts/seo-agent/discover.mjs [категория] [limit]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR } from './config.mjs';
import { scoreCitability } from './lib/citability.mjs';
import { snapshotHtml } from './lib/drift.mjs';
import { addProspect, addNote, listProspects } from './prospect.mjs';

const CAND = join(ROOT_DIR, 'scripts/seo-agent/data/agency/candidates.json');
const norm = (u) => String(u).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').toLowerCase();
const loadCandidates = () => { try { return JSON.parse(readFileSync(CAND, 'utf-8')); } catch { return []; } };

export function candidateStats() {
  const c = loadCandidates(); const by = {};
  for (const x of c) by[x.category] = (by[x.category] || 0) + 1;
  return { total: c.length, by };
}

async function probe(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(12000), headers: { 'user-agent': 'Mozilla/5.0 audit' } });
    if (!r.ok) return { ok: false, score: 0, reason: `HTTP ${r.status}` };
    const html = await r.text();
    const snap = snapshotHtml(html);
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
    const cit = scoreCitability(text).score;
    const schema = snap.schemaTypes.length ? 100 : 0;
    const seo = (snap.title ? 40 : 0) + (snap.description ? 30 : 0) + (snap.h1count === 1 ? 30 : 0);
    return { ok: true, score: Math.round(cit * 0.4 + schema * 0.3 + seo * 0.3), cit, hasSchema: !!snap.schemaTypes.length, hasTitle: !!snap.title };
  } catch (e) { return { ok: false, score: 0, reason: e.message }; }
}

/**
 * @param {string} [category] — 'стоматология' | 'интернет-магазин' (иначе все)
 * @param {object} [opt] — { limit=12 }
 * @returns {Promise<{scanned, added, items[]}>}
 */
export async function discover(category, { limit = 12 } = {}) {
  const inFunnel = new Set(listProspects().map((p) => norm(p.url)));
  const SOCIAL = /^(t\.me|vk\.com|instagram|facebook|ok\.ru|youtube|wa\.me)/i;
  const cands = loadCandidates()
    .filter((c) => !category || c.category === category)
    .filter((c) => c.url && !SOCIAL.test(norm(c.url)) && !inFunnel.has(norm(c.url)));
  const results = [];
  for (const c of cands.slice(0, limit * 3)) {
    const p = await probe(c.url);
    if (p.ok) results.push({ ...c, probe: p });
    if (results.length >= limit * 2) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const good = results.sort((a, b) => a.probe.score - b.probe.score).slice(0, limit); // слабее сайт → выше
  const items = [];
  for (const r of good) {
    const contact = [r.phone, r.email, r.telegram].filter(Boolean).join(' · ');
    const pr = addProspect(r.url, r.name, { category: r.category, score: r.probe.score, contact, source: '2gis' });
    if (!pr.error) { addNote(pr.id, `2ГИС · ${r.rubric || r.category} · экспресс-оценка ${r.probe.score}/100 · ${contact}`); items.push({ ...r, id: pr.id }); }
  }
  return { scanned: results.length, added: items.length, items };
}

export function fmtDiscover(res, category) {
  if (!res.added) return `Новых кандидатов не найдено${category ? ` (${category})` : ''}. Проверено ${res.scanned}.`;
  const L = [`🔎 <b>Найдено ${res.added} кандидатов${category ? ` · ${category}` : ''}</b> (слабее сайт = выше в списке):`, ''];
  for (const x of res.items) {
    const c = [x.phone, x.email, x.telegram].filter(Boolean).join(' · ');
    L.push(`• <b>${x.domain}</b> — ${x.probe.score}/100 · ${x.name.slice(0, 40)}\n  ${c}  <code>/audit ${x.url}</code>`);
  }
  L.push('', 'Все добавлены в воронку (🎯). Полный аудит/КП: <code>/audit</code> · <code>/kp &lt;url&gt;</code>');
  return L.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cat = process.argv[2] || undefined;
  discover(cat, { limit: Number(process.argv[3]) || 10 }).then((r) => console.log(fmtDiscover(r, cat).replace(/<[^>]+>/g, '')));
}
