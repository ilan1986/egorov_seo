// GEO citability scorer — детерминированная оценка «насколько статью удобно цитировать нейросети».
// Без LLM: разбивает текст на секции по H2/H3, оценивает каждую по 5 категориям (0-100),
// возвращает общий балл + слабые секции для точечного переписывания. Используется как гейт
// фактчека (рядом со «слов≥1300 / уникальность≥82%») и в daily-report (средняя citability).
//
// Основано на исследовательских бенчмарках GEO: answer-first, self-contained абзацы 90-160 слов,
// плотность фактов/цифр, definition-паттерн, вопросные заголовки — то, что модели вырезают в ответ.

const RU_STOP_LEAD = /^(это|этот|эта|эти|тот|такой|он|она|они|оно|его|её|их|там|тут|здесь|поэтому|таким образом|кроме того|однако|но|а|и|также|при этом|в итоге|в результате|значит)\b/i;
const DEF_PATTERN = /\s+[—–-]\s+это\s+|\s+является\s+|\s+называется\s+|\s+означает\s+|\bпод\s+\w+\s+понимают?\b/i;
const QUESTION_WORDS = /^(что|как|почему|зачем|когда|где|какой|какая|какие|сколько|можно ли|нужно ли|стоит ли|чем|кому|для кого|в чём)/i;

const words = (s) => (s.match(/[А-Яа-яЁёA-Za-z0-9]+/g) || []);
const sentences = (s) => s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);

// Разбить markdown/prose на секции: {heading, isQuestion, body}
function splitSections(md) {
  const lines = md.split('\n');
  const secs = [];
  let cur = { heading: '', isQuestion: false, body: [] };
  for (const ln of lines) {
    const h = ln.match(/^#{2,3}\s+(.+?)\s*$/);
    if (h) {
      if (cur.heading || cur.body.length) secs.push(cur);
      const title = h[1].replace(/[*_`]/g, '').trim();
      cur = { heading: title, isQuestion: QUESTION_WORDS.test(title) || title.includes('?'), body: [] };
    } else {
      cur.body.push(ln);
    }
  }
  if (cur.heading || cur.body.length) secs.push(cur);
  return secs;
}

// Оценка одной секции 0-100 по 5 категориям (равный вес по 20).
function scoreSection(sec) {
  const text = sec.body.join('\n').replace(/```[\s\S]*?```/g, ' ').replace(/[|>#*_`-]/g, ' ');
  const sents = sentences(text);
  const w = words(text);
  const wc = w.length;
  if (wc < 15) return { score: 0, wc, reasons: ['слишком коротко'] };

  const reasons = [];
  let answerFirst = 0, selfContained = 0, structure = 0, statDensity = 0, definition = 0;

  // 1. Answer-first: первое предложение — прямой ответ (не вода, есть содержание, ≤35 слов)
  const first = sents[0] || '';
  const fw = words(first).length;
  if (fw >= 6 && fw <= 35 && !RU_STOP_LEAD.test(first.trim())) answerFirst = 20;
  else if (fw >= 6 && fw <= 45) answerFirst = 10;
  else reasons.push('нет чёткого ответа в первой фразе');

  // 2. Self-containment: не начинается с местоимения/союза, назван субъект (заголовок или сущность)
  if (!RU_STOP_LEAD.test(first.trim())) selfContained += 12;
  else reasons.push('первая фраза начинается с местоимения/союза');
  const headWords = words(sec.heading).filter((x) => x.length > 4).map((x) => x.toLowerCase());
  if (headWords.some((hw) => text.toLowerCase().includes(hw))) selfContained += 8;

  // 3. Structure: оптимальная длина секции (90-160 слов) + наличие списка/таблицы
  if (wc >= 90 && wc <= 170) structure += 12;
  else if (wc >= 60 && wc <= 220) structure += 7;
  else reasons.push(`длина секции ${wc} сл. вне оптимума 90-170`);
  if (/^\s*[-*]\s+/m.test(sec.body.join('\n')) || /\|.*\|/.test(sec.body.join('\n'))) structure += 8;

  // 4. Statistical density: цифры/проценты/годы/единицы — цитируемая конкретика
  const nums = (text.match(/\b\d[\d.,]*\s*(%|₽|руб|год|дн|дней|мес|раз|шт|км|кг|мин|сек|тыс|млн)?/gi) || []).length;
  const density = nums / Math.max(1, sents.length);
  if (density >= 0.5) statDensity = 20;
  else if (density >= 0.25) statDensity = 12;
  else { statDensity = 4; reasons.push('мало конкретики (цифр/фактов)'); }

  // 5. Definition/entity clarity: есть паттерн определения ИЛИ вопросный заголовок с ответом
  if (DEF_PATTERN.test(text)) definition += 12;
  if (sec.isQuestion) definition += 8;
  if (!DEF_PATTERN.test(text) && !sec.isQuestion) reasons.push('нет определения/вопросного заголовка');
  definition = Math.min(20, definition);

  const score = Math.round(answerFirst + selfContained + structure + statDensity + definition);
  return { score, wc, heading: sec.heading, reasons };
}

/**
 * Оценить цитируемость статьи.
 * @param {string} md — тело статьи (markdown/MDX без фронтматтера)
 * @returns {{score:number, sections:Array, weakSections:Array}} score 0-100 (средневзвешенно по словам)
 */
export function scoreCitability(md) {
  const body = String(md).replace(/^---\n[\s\S]*?\n---\n/, '');
  const secs = splitSections(body).filter((s) => words(s.body.join(' ')).length >= 15);
  if (!secs.length) return { score: 0, sections: [], weakSections: [] };
  const scored = secs.map(scoreSection);
  const totalW = scored.reduce((a, s) => a + s.wc, 0) || 1;
  const score = Math.round(scored.reduce((a, s) => a + s.score * s.wc, 0) / totalW);
  const weakSections = scored.filter((s) => s.score < 60).sort((a, b) => a.score - b.score);
  return { score, sections: scored, weakSections };
}

/** Компактная строка для отчёта/лога. */
export function citabilitySummary(md) {
  const r = scoreCitability(md);
  const weak = r.weakSections.slice(0, 3).map((s) => `«${s.heading || '—'}» (${s.score})`).join(', ');
  return `citability ${r.score}/100${weak ? `; слабые: ${weak}` : ''}`;
}
