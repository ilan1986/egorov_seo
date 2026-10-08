// Обложки из Pixabay: реальные фотографии зданий (лицензия Pixabay: коммерческое использование без указания автора).
// Правила API соблюдены: на КАЖДУЮ новую статью — 1 поисковый запрос (ответы кэшируются 24 ч) и 1 скачивание фото
// на свой сервер (хотлинк запрещён); массовых и пакетных загрузок нет. Лимит 100 запросов/мин не достигается.
// Включается переменной IMAGE_PROVIDER=pixabay (см. images.mjs). Ключ: PIXABAY_API_KEY или файл PIXABAY_KEY_FILE.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { optimizeTo } from './kie-nb2.mjs';

const DIR = process.env.COVER_POOL_DIR || '/opt/cover-pool';
const KEY_FILE = process.env.PIXABAY_KEY_FILE || `${DIR}/pixabay.key`;
const USED_FILE = `${DIR}/used.json`; // {pixabayId: {name, site, at, user, page}} — общий на всю сеть: одно фото не ставим дважды
const CACHE_DIR = `${DIR}/cache`;
const CACHE_MS = 24 * 3600 * 1000;
const QUERIES = (process.env.COVER_QUERIES ||
  'modern apartment building,high-rise residential building,residential complex,apartment block,new residential building,multi-storey building,housing estate,building under construction crane')
  .split(',').map((s) => s.trim()).filter(Boolean);
// теги, при которых фото не берём (нужны только здания и сооружения, без людей и «посторонних» сюжетов)
const BAD_TAGS = /\b(woman|women|man|men|girl|boy|child|children|kid|people|person|portrait|wedding|bride|groom|model|baby|couple|family|nude|bikini|dog|cat|food|flower|flowers)\b/i;
// нужны ТОЛЬКО современные многоквартирные дома, жилые комплексы и стройки: берём фото, у которых есть «жилые» теги, и отсекаем старину/туризм/монохром
const HOUSING_GOOD = /(apartment|residential|high.?rise|housing|condominium|multi.?storey|multi.?story|skyscraper|construction|crane|new building|block of flats|flats|tower block|modern architecture|modern building)/i;
const HOUSING_EXCLUDE = /\b(?:old town|medieval|historic|history|castle|church|cathedral|temple|mosque|palace|ruin|abandoned|rooftops?|roofs?|tourism|tourist|sightseeing|paris|italy|france|spain|croatia|dubrovnik|venice|prague|black and white|monochrome|sepia|vintage|retro|interior|room|bedroom|kitchen|furniture|street art|graffiti|bridge|cars?|boat|ship|snow|winter|beach|sea|ocean|coast|island|lake|mountains?|mediterranean|texture|pattern|abstract|minimalist|minimal|details?|walls?|windows?|balcon(?:y|ies)|stairs|staircase|doors?|ancient|old|shutters|sold|sale|signs?|houses?|homes?|villa|cottage|pool|swimming)\b/i;
// Профиль под другую нишу: COVER_CATEGORY (категория Pixabay; 'any' = без категории), COVER_GOOD_TAGS / COVER_EXCLUDE_TAGS / COVER_BAD_TAGS — regexp-строки.
// Без COVER_CATEGORY действует профиль «жилые дома» (категория buildings + фильтры выше).
const CATEGORY = process.env.COVER_CATEGORY === undefined ? 'buildings' : process.env.COVER_CATEGORY.trim();
const rx = (v, d, whole) => (v ? new RegExp(whole ? '\\b(?:' + v + ')\\b' : v, 'i') : d); // whole: слова целиком (EXCLUDE/BAD), иначе «sign» ловит «design»
const GENERIC_EXCLUDE = /(?:nude|bikini|sepia|black and white|monochrome|logo|text|sign|signs|advertising)/i;
const GOOD_TAGS = rx(process.env.COVER_GOOD_TAGS, process.env.COVER_CATEGORY === undefined ? HOUSING_GOOD : null);
const EXCLUDE_TAGS = rx(process.env.COVER_EXCLUDE_TAGS, process.env.COVER_CATEGORY === undefined ? HOUSING_EXCLUDE : GENERIC_EXCLUDE, true);
const BAD = rx(process.env.COVER_BAD_TAGS, BAD_TAGS, true);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash('sha1').update(s).digest('hex');
const hashNum = (s) => parseInt(sha(s).slice(0, 8), 16);

function apiKey() {
  const k = (process.env.PIXABAY_API_KEY || '').trim();
  if (k) return k;
  try { return readFileSync(KEY_FILE, 'utf8').trim(); } catch { throw new Error('Pixabay: не найден ключ (PIXABAY_API_KEY или ' + KEY_FILE + ')'); }
}

async function search(query, page) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cf = `${CACHE_DIR}/${sha(query + '|' + page + '|' + CATEGORY)}.json`;
  try { if (Date.now() - statSync(cf).mtimeMs < CACHE_MS) return JSON.parse(readFileSync(cf, 'utf8')); } catch { /* кэша нет */ }
  const url = `https://pixabay.com/api/?key=${encodeURIComponent(apiKey())}&q=${encodeURIComponent(query)}&image_type=photo&${CATEGORY && CATEGORY !== 'any' ? 'category=' + CATEGORY + '&' : ''}orientation=horizontal&min_width=1280&safesearch=true&order=popular&per_page=200&page=${page}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (r.status === 429) { await sleep(20_000 + attempt * 20_000); continue; } // лимит 100/мин
    if (!r.ok) throw new Error(`Pixabay HTTP ${r.status}`);
    const j = await r.json();
    const hits = (j.hits || []).map((h) => ({ id: h.id, tags: h.tags, w: h.imageWidth, h: h.imageHeight, large: h.largeImageURL, user: h.user, page: h.pageURL }));
    writeFileSync(cf, JSON.stringify(hits));
    return hits;
  }
  throw new Error('Pixabay: лимит запросов (429)');
}

const loadUsed = () => { try { return JSON.parse(readFileSync(USED_FILE, 'utf8')); } catch { return {}; } };
function saveUsed(u) { mkdirSync(DIR, { recursive: true }); const t = USED_FILE + '.' + process.pid + '.tmp'; writeFileSync(t, JSON.stringify(u)); renameSync(t, USED_FILE); }

/** Выбрать неиспользованное фото по хэшу имени (стабильно и разнообразно) и сохранить как public/images/<name>.jpg. */
export async function pixabayCover({ name, width = 1200, height, format = 'jpg', quality = 80 }) {
  const h = height || Math.round((width * 9) / 16);
  const used = loadUsed();
  const base = hashNum(name);
  let pick = null, anyOk = null;
  for (let qi = 0; qi < QUERIES.length && !pick; qi++) {
    const query = QUERIES[(base + qi) % QUERIES.length];
    for (let page = 1; page <= 3 && !pick; page++) {
      let hits; try { hits = await search(query, page); } catch (e) { if (qi === 0 && page === 1) throw e; continue; }
      const ok = hits.filter((x) => x.large && x.w >= 1280 && !BAD.test(x.tags || '') && !EXCLUDE_TAGS.test(x.tags || '') && (!GOOD_TAGS || GOOD_TAGS.test(x.tags || '')));
      if (!anyOk && ok.length) anyOk = ok[base % ok.length];
      const fresh = ok.filter((x) => !used[x.id]);
      if (fresh.length) pick = fresh[base % fresh.length];
      if (!hits.length || hits.length < 200) break; // дальше страниц нет
    }
  }
  pick = pick || anyOk; // пул исчерпан — допускаем повтор
  if (!pick) throw new Error('Pixabay: не нашлось подходящих фото');
  const res = await optimizeTo(pick.large, { name, width, height: h, format, quality });
  const u = loadUsed();
  u[pick.id] = { name, site: basename(process.cwd()), at: new Date().toISOString(), user: pick.user, page: pick.page };
  saveUsed(u);
  return { ...res, source: 'pixabay', pixabayId: pick.id };
}
