// SERP-интент (из seo-sxo): классифицирует ТИП страниц в топ-10 Яндекса по запросу, чтобы НЕ тратить
// платную генерацию на ключи, где статья не выигрывает (топ занят агрегаторами/маркетплейсами/картами).
// Детерминированно, на уже подключённом xmlstock (SERP передаётся как вход). Гейт перед generate-post.

const PATTERNS = [
  { type: 'aggregator', re: /(avito|cian|domclick|yandex\.ru\/maps|2gis|zoon|yell|flamp|prodoctorov|napopravku|profi\.ru|youla|drom)/i },
  { type: 'marketplace', re: /(wildberries|ozon|market\.yandex|aliexpress|megamarket|lemanapro|vseinstrumenti)/i },
  { type: 'video', re: /(youtube\.com|youtu\.be|rutube|vk\.com\/video|dzen\.ru\/video)/i },
  { type: 'social', re: /(vk\.com|t\.me|ok\.ru|instagram|pikabu|otvet\.mail|forum)/i },
  { type: 'wiki', re: /(wikipedia\.org|wikimedia)/i },
  { type: 'catalog', re: /\/(catalog|category|product|tovar|goods|shop)\//i },
  { type: 'gov', re: /(gov\.ru|nalog\.ru|gosuslugi|consultant\.ru|garant\.ru)/i },
];

const classifyUrl = (url = '') => {
  for (const p of PATTERNS) if (p.re.test(url)) return p.type;
  return 'article'; // контентная/статейная по умолчанию
};

/**
 * @param {string} keyword
 * @param {Array<{url:string,title?:string}>} serp — топ-10 из xmlstock (yandexSerp)
 * @returns {{dominantType, counts, intentMatch:boolean, articleShare:number, verdict}}
 */
export function classifySerp(keyword, serp = []) {
  const top = serp.slice(0, 10);
  if (!top.length) return { dominantType: null, counts: {}, intentMatch: true, articleShare: null, verdict: 'нет SERP — генерировать (нет данных)' };
  const counts = {};
  for (const r of top) { const t = classifyUrl(r.url || r.link || ''); counts[t] = (counts[t] || 0) + 1; }
  const dominantType = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const articleShare = Math.round(((counts.article || 0) + (counts.wiki || 0) + (counts.gov || 0)) / top.length * 100);

  // Статья выигрывает, если контентных результатов хотя бы 30% — иначе топ «чужой»
  const blocked = (counts.aggregator || 0) + (counts.marketplace || 0) + (counts.catalog || 0);
  const intentMatch = articleShare >= 30 && blocked < 6;
  let verdict;
  if (!intentMatch && blocked >= 6) verdict = `⏭️ пропустить: топ занят агрегаторами/каталогами (${blocked}/10) — статья не выиграет`;
  else if (articleShare >= 60) verdict = '✅ отличный ключ: топ информационный, статья уместна';
  else if (intentMatch) verdict = `🟡 смешанный интент (статей ${articleShare}%) — можно, но ниже приоритет`;
  else verdict = `⏭️ понизить: мало статейного интента (${articleShare}%)`;
  return { dominantType, counts, intentMatch, articleShare, verdict };
}

/** Фильтр списка ключей-кандидатов: оставить те, где статья реально может в топ. */
export function filterWinnable(candidates) {
  // candidates: [{query, serp}] — serp уже получен вызывающим (yandexSerp)
  return candidates
    .map((c) => ({ ...c, intent: classifySerp(c.query, c.serp) }))
    .filter((c) => c.intent.intentMatch);
}
