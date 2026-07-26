// Конкурентный content-brief (из seo-content-brief): перед генерацией анализирует топ-5 Яндекса по
// запросу + PAA/LSI (Arsenkin) и строит аутлайн с «information gain» — что конкуренты НЕ раскрыли.
// Результат подмешивается в systemPrompt generate-post → статья дифференцируется, меньше «клонов».
// На уже подключённых API (xmlstock SERP передаётся вызывающим, aigate для анализа).
import { ask } from './aigate.mjs';

/**
 * @param {string} keyword
 * @param {Array<{title?,snippet?,url?}>} serp — топ-5 из xmlstock
 * @param {object} [extra] — { paa:string[], lsi:string[] }
 * @returns {Promise<{outline:string[], gaps:string[], mustCover:string[], targetWords:number, promptBlock:string}>}
 */
export async function buildBrief(keyword, serp = [], { paa = [], lsi = [] } = {}) {
  const top = serp.slice(0, 5);
  const compet = top.map((r, i) => `${i + 1}. ${(r.title || '').trim()} — ${(r.snippet || r.passage || '').slice(0, 160)}`).join('\n');
  const sys = 'Ты — контент-стратег SEO. По выдаче конкурентов и вопросам пользователей составь бриф для НОВОЙ статьи, ' +
    'которая будет ЛУЧШЕ и ПОЛНЕЕ конкурентов (information gain — раскрой то, что они упустили). Отвечай строго JSON.';
  const user =
    `Запрос: "${keyword}"\n\n` +
    (compet ? `Конкуренты в топе:\n${compet}\n\n` : '') +
    (paa.length ? `Вопросы пользователей (обязательно закрыть): ${paa.slice(0, 8).join(' | ')}\n` : '') +
    (lsi.length ? `LSI-термины (органично вписать): ${lsi.slice(0, 20).join(', ')}\n` : '') +
    `\nВерни JSON: {"outline":["H2-заголовок (вопросом)", ...6-9], "gaps":["что конкуренты не раскрыли", ...3-5], ` +
    `"mustCover":["обязательные подтемы/факты", ...5-8], "targetWords": <число 1300-2200>}`;

  let raw;
  try { raw = await ask(sys, user, { maxTokens: 1100, temperature: 0.5 }); }
  catch (e) { return fallback(keyword, paa, `LLM недоступен: ${e.message}`); }
  let b;
  try { b = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); }
  catch { return fallback(keyword, paa, 'не разобрал JSON брифа'); }

  const outline = Array.isArray(b.outline) ? b.outline : [];
  const gaps = Array.isArray(b.gaps) ? b.gaps : [];
  const mustCover = Array.isArray(b.mustCover) ? b.mustCover : [];
  const targetWords = Number(b.targetWords) || 1600;

  const promptBlock = [
    'БРИФ (сделай статью полнее конкурентов):',
    outline.length ? `Структура (H2): ${outline.join(' / ')}` : '',
    gaps.length ? `Раскрой то, что упустили конкуренты (information gain): ${gaps.join('; ')}` : '',
    mustCover.length ? `Обязательно закрыть: ${mustCover.join('; ')}` : '',
    `Целевой объём: ~${targetWords} слов.`,
  ].filter(Boolean).join('\n');

  return { outline, gaps, mustCover, targetWords, promptBlock };
}

function fallback(keyword, paa, note) {
  return {
    outline: paa.slice(0, 6),
    gaps: [], mustCover: paa.slice(0, 6), targetWords: 1600,
    promptBlock: `БРИФ (упрощённый, ${note}): закрой вопросы — ${paa.slice(0, 6).join('; ')}.`,
    note,
  };
}
