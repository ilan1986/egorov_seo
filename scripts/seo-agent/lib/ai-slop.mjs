// AI-slop детектор (из blog-analyze): измеряемый гейт «человечности» текста рядом с citability/eeat.
// Сейчас в пайплайне есть шаг «очеловечивание», но БЕЗ метрики — этот модуль её даёт. Детерминированно.
// Сигналы: burstiness (вариативность длин предложений — у ИИ она низкая), банлист клише-фраз, лексическое
// разнообразие (type-token ratio). Ниже порога — прогнать через humanizer ещё раз / переписать.

// Клише-фразы, характерные для ИИ-текста (RU). Расширяемо.
const BANNED = [
  'в современном мире', 'в наше время', 'играет важную роль', 'является неотъемлемой частью',
  'стоит отметить, что', 'важно понимать, что', 'не секрет, что', 'в заключение стоит',
  'таким образом,', 'подводя итог', 'в этой статье мы', 'давайте разберёмся',
  'мир не стоит на месте', 'с каждым днём всё больше', 'открывает новые возможности',
  'позволяет значительно', 'широкий спектр', 'ключевую роль', 'на сегодняшний день',
  'нельзя не отметить', 'следует учитывать', 'является одним из самых',
];

const sentences = (t) => t.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter((s) => s.length > 3);
const words = (t) => (t.toLowerCase().match(/[а-яёa-z0-9-]+/gi) || []);

/**
 * @param {string} mdx
 * @returns {{score:number, burstiness:number, vocabDiversity:number, banned:string[], verdict}}
 * score 0-100 (выше = человечнее)
 */
export function scoreAiSlop(mdx) {
  const body = String(mdx).replace(/^---\n[\s\S]*?\n---\n/, '').replace(/```[\s\S]*?```/g, ' ').replace(/[#*_`|>-]/g, ' ');
  const sents = sentences(body);
  const w = words(body);
  if (sents.length < 5 || w.length < 100) return { score: 50, burstiness: 0, vocabDiversity: 0, banned: [], verdict: 'мало текста для оценки' };

  // 1. Burstiness: стандартное отклонение длин предложений / средняя длина. У людей выше (0.5-0.9), у ИИ ниже.
  const lens = sents.map((s) => words(s).length);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
  const burstiness = mean ? sd / mean : 0;

  // 2. Vocab diversity (type-token ratio) на первых 400 словах — у ИИ бывает выше «водность»/повтор.
  const sample = w.slice(0, 400);
  const vocabDiversity = new Set(sample).size / (sample.length || 1);

  // 3. Банлист клише
  const low = body.toLowerCase();
  const banned = BANNED.filter((p) => low.includes(p));

  // Скоринг
  let score = 100;
  if (burstiness < 0.35) score -= 30; else if (burstiness < 0.5) score -= 12;
  if (vocabDiversity < 0.35) score -= 15; else if (vocabDiversity < 0.42) score -= 6;
  score -= Math.min(35, banned.length * 7);
  score = Math.max(0, Math.round(score));

  const verdict = score >= 70 ? '✅ человечно' : score >= 55 ? '🟡 средне — стоит очеловечить' : '⚠️ похоже на ИИ-текст — переписать/humanizer';
  return { score, burstiness: Math.round(burstiness * 100) / 100, vocabDiversity: Math.round(vocabDiversity * 100) / 100, banned, verdict };
}

export function aiSlopSummary(mdx) {
  const r = scoreAiSlop(mdx);
  return `human ${r.score}/100 (burstiness ${r.burstiness}, разнообразие ${r.vocabDiversity})${r.banned.length ? '; клише: ' + r.banned.slice(0, 3).join(', ') : ''}`;
}
