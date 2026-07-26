// Brand Authority Score (RU) — упоминания бренда на площадках, которым доверяют нейросети.
// Исследования GEO: unlinked-упоминания коррелируют с AI-цитируемостью ~3x сильнее беклинков.
// US-веса (Reddit/Wikipedia/LinkedIn) адаптированы под РФ: VK/Дзен/Хабр/Пикабу/YouTube/Wikidata.
// Через xmlstock (`<бренд> site:platform`) считаем присутствие; еженедельный cron → Telegram.
import { CONFIG, ROOT_DIR, readiness } from './config.mjs';
import { yandexSerp } from './lib/xmlstock.mjs';
import { PROFILE } from '../../site.profile.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const GEO = PROFILE.geo || {};
const BRAND = GEO.brand || PROFILE.bot?.projectName || '';
const DATA = join(ROOT_DIR, 'scripts/seo-agent/data');
const OUT = join(DATA, 'brand-authority.json');

// Площадки и веса под РФ (сумма = 100). YouTube/Wikipedia универсальны.
const PLATFORMS = [
  { key: 'YouTube', host: 'youtube.com', weight: 22 },
  { key: 'Wikipedia/Wikidata', host: 'ru.wikipedia.org', weight: 20 },
  { key: 'VK', host: 'vk.com', weight: 16 },
  { key: 'Дзен', host: 'dzen.ru', weight: 14 },
  { key: 'Хабр', host: 'habr.com', weight: 12 },
  { key: 'Пикабу', host: 'pikabu.ru', weight: 8 },
  { key: 'Telegram', host: 't.me', weight: 8 },
];

async function presence(host) {
  try {
    const res = await yandexSerp(`${BRAND} site:${host}`, { groups: 10 });
    const n = Array.isArray(res) ? res.length : (res?.results?.length || 0);
    return n; // 0 = нет присутствия
  } catch { return null; }
}

/** @returns {Promise<{score:number, platforms:Array, weakest:Array}>} */
export async function brandAuthority() {
  if (!BRAND) return { score: null, platforms: [], note: 'нет geo.brand в профиле' };
  if (!readiness().xmlstock && !CONFIG.xmlstock?.user) return { score: null, platforms: [], note: 'xmlstock не настроен' };
  const rows = [];
  for (const p of PLATFORMS) {
    const n = await presence(p.host);
    // балл площадки: есть присутствие → полный вес; частично по объёму
    const got = n == null ? 0 : n >= 3 ? p.weight : n >= 1 ? p.weight * 0.6 : 0;
    rows.push({ ...p, found: n, points: Math.round(got) });
    await new Promise((r) => setTimeout(r, 700));
  }
  const score = Math.round(rows.reduce((a, r) => a + r.points, 0));
  const weakest = rows.filter((r) => r.points === 0).map((r) => r.key);

  try {
    mkdirSync(DATA, { recursive: true });
    const hist = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf-8')) : { history: [] };
    hist.history = (hist.history || []).slice(-20);
    hist.history.push({ date: new Date().toISOString().slice(0, 10), score });
    hist.latest = { score, platforms: rows, weakest };
    writeFileSync(OUT, JSON.stringify(hist, null, 2), 'utf-8');
  } catch { /* не критично */ }

  return { score, platforms: rows, weakest };
}

export function brandReportLine(r) {
  if (r?.score == null) return '🏷 Brand Authority: нет данных (' + (r?.note || '') + ').';
  const weak = r.weakest?.length ? `; нет присутствия: ${r.weakest.join(', ')}` : '';
  return `🏷 Brand Authority: ${r.score}/100${weak}`;
}

// CLI: node scripts/seo-agent/brand-mentions.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  brandAuthority().then((r) => {
    console.log(brandReportLine(r));
    for (const p of r.platforms || []) console.log(` ${p.points > 0 ? '✓' : '·'} ${p.key}: найдено ${p.found ?? '—'} (+${p.points})`);
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
