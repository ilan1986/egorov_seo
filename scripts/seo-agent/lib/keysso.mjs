// keys.so — SEO/Директ-аналитика по позициям, частотности и рекламе конкурентов (опт-ин).
// Включается переменной окружения KEYSO_TOKEN. Хост api.keys.so, заголовок X-Keyso-TOKEN.
// Ярославля в базах keys.so нет → по умолчанию база 'msk' (запросы всё равно гео-тегированы isgeo).
// Даёт агенту: striking-distance (частотные запросы на позициях 11-30 → дожать), органических
// конкурентов, Директ-конкурентов и их рекламные ключи (ядро для нейро-директолога).
const BASE = 'https://api.keys.so';
const TOKEN = process.env.KEYSO_TOKEN || '';
const REG = process.env.KEYSO_REGION || 'msk';

export function keysoReady() {
  return Boolean(TOKEN);
}

/** GET к keys.so с ретраем на 202 («отчёт строится»). Возвращает JSON или null. */
async function ksGet(path, { tries = 8, delayMs = 12000 } = {}) {
  for (let i = 0; i < tries; i++) {
    let json = null;
    try {
      const r = await fetch(BASE + path, {
        headers: { 'X-Keyso-TOKEN': TOKEN, Accept: 'application/json' },
        signal: AbortSignal.timeout(30000),
      });
      json = await r.json().catch(() => null);
    } catch {
      /* сеть — попробуем ещё */
    }
    if (json && json.code === 202) { await new Promise((r) => setTimeout(r, delayMs)); continue; }
    return json;
  }
  return null;
}

const enc = (s) => encodeURIComponent(String(s));

/** Все органические запросы домена с позициями и частотностью (Wordstat). */
export async function organicKeywords(domain, { pages = 4, perPage = 100 } = {}) {
  const out = [];
  for (let p = 1; p <= pages; p++) {
    const j = await ksGet(`/report/simple/organic/keywords?base=${REG}&domain=${enc(domain)}&per_page=${perPage}&current_page=${p}&sort=ws|desc`);
    const data = j && j.data;
    if (!data || !data.length) break;
    out.push(...data);
    if (p >= (j.last_page || 1)) break;
  }
  return out; // [{word,url,pos,ws,wsk,adscnt,isgeo,...}]
}

/** Striking-distance: частотные запросы на позициях posMin..posMax (по умолч. 11-30, ws>=minWs). */
export async function strikingDistance(domain, { minWs = 100, posMin = 11, posMax = 30 } = {}) {
  const kw = await organicKeywords(domain);
  const seen = new Set();
  return kw
    .filter((r) => (r.pos || 99) >= posMin && (r.pos || 99) <= posMax && (r.ws || 0) >= minWs)
    .filter((r) => { const k = r.word; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (b.ws || 0) - (a.ws || 0))
    .map((r) => ({ query: r.word, pos: r.pos, ws: r.ws, adscnt: r.adscnt || 0, url: r.url }));
}

/** Органические конкуренты домена (пересечение семантики). */
export async function organicCompetitors(domain, { limit = 10 } = {}) {
  const j = await ksGet(`/report/simple/organic/concurents?base=${REG}&domain=${enc(domain)}&per_page=${limit}&sort=vis|desc`);
  return (j && j.data) ? j.data.map((r) => ({ domain: r.name, common: r.cnt, vis: r.vis })) : [];
}

/** Директ-конкуренты: кто рекламируется по нашей нише + объёмы. */
export async function directCompetitors(domain, { limit = 10 } = {}) {
  const j = await ksGet(`/report/simple/context/concurents?base=${REG}&domain=${enc(domain)}&per_page=${limit}&sort=adkeyscnt|desc`);
  return (j && j.data) ? j.data.map((r) => ({ domain: r.name, ads: r.adscnt, adKeys: r.adkeyscnt })) : [];
}

/** Рекламные (Директ) ключи конкурента — ядро для нейро-директолога. */
export async function directKeywords(competitorDomain, { limit = 50 } = {}) {
  const j = await ksGet(`/report/simple/context/keywords?base=${REG}&domain=${enc(competitorDomain)}&per_page=${limit}&sort=ws|desc`);
  return (j && j.data) ? j.data.map((r) => ({ query: r.word, ws: r.ws, bid: r.avbid })) : [];
}

/** Сводка для отчёта/дообогащения агента. */
export async function keysoInsights(domain) {
  const [striking, orgComp, dirComp] = await Promise.all([
    strikingDistance(domain),
    organicCompetitors(domain, { limit: 8 }),
    directCompetitors(domain, { limit: 8 }),
  ]);
  // ключи топ-Директ-конкурента (локального, не федерального агрегатора)
  let directCore = [];
  const local = dirComp.find((c) => /\.ru$/.test(c.domain) && !/yandex|onelink|avito|cian|domclick/.test(c.domain));
  if (local) directCore = await directKeywords(local.domain, { limit: 40 });
  return { domain, striking, organicCompetitors: orgComp, directCompetitors: dirComp, directCoreFrom: local?.domain || null, directCore };
}
