// Лёгкий E-E-A-T гейт: проверяет сгенерированную статью на сигналы Experience/Expertise/
// Authoritativeness/Trustworthiness, которые нейросети используют для доверия к источнику.
// Детерминированно (без LLM). Использовать как гейт генерации рядом с citability.
// Приём из geo-content. Для YMYL-ниш (мед/юр/фин) — обязательные дисклеймеры.
import { PROFILE } from '../../../site.profile.mjs';

const GEO = PROFILE.geo || {};
const YMYL = /мед|здоров|болезн|лечен|юрид|прав|налог|банкрот|финанс|инвест|кредит|займ/i;
const isYmyl = () => YMYL.test((PROFILE.generation?.topicClusters || '') + ' ' + (GEO.author?.knowsAbout || []).join(' '));

const has = (re, s) => re.test(s);

/**
 * Оценить E-E-A-T статьи 0-100.
 * @param {string} mdx — статья с фронтматтером
 * @returns {{score:number, missing:string[], signals:object}}
 */
export function scoreEeat(mdx) {
  const src = String(mdx);
  const fm = src.match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
  const body = src.replace(/^---\n[\s\S]*?\n---\n/, '');
  const missing = [];
  let score = 0;

  // Authoritativeness: указан автор (в профиле geo.author) — сущность-эксперт
  if (GEO.author?.name) score += 15;
  else missing.push('нет автора в geo.author (Person-сущность)');
  if (GEO.author?.sameAs?.length) score += 10;
  else missing.push('нет author.sameAs (профили эксперта — сильнейший сигнал доверия)');
  if (GEO.author?.jobTitle || GEO.author?.knowsAbout?.length) score += 10;
  else missing.push('нет должности/экспертизы автора');

  // Trustworthiness: даты (свежесть/актуальность)
  if (has(/pubDate:/i, fm)) score += 10; else missing.push('нет pubDate');
  // Trust: ссылки на источники в теле (внешние авторитетные)
  const extLinks = (body.match(/\]\(https?:\/\/[^)]+\)/g) || []).length;
  if (extLinks >= 2) score += 15;
  else if (extLinks === 1) score += 8;
  else missing.push('нет внешних ссылок на источники (0 цитирований первоисточников)');

  // Expertise: глубина (объём) + структура (факты/таблицы)
  const words = (body.match(/[А-Яа-яЁёA-Za-z0-9]+/g) || []).length;
  if (words >= 1300) score += 10; else missing.push(`тонкий контент (${words} сл. < 1300)`);
  if (/\|.*\|/.test(body)) score += 5; else missing.push('нет таблиц (структурная экспертиза)');

  // Experience: признаки практики (конкретика/примеры/кейсы)
  if (/(на практике|например|в нашем опыте|мы делали|кейс|пример из|по опыту)/i.test(body)) score += 10;
  else missing.push('нет сигналов практического опыта (примеры/кейсы)');

  // YMYL: дисклеймер обязателен
  if (isYmyl()) {
    if (/(не является|носит информационн|проконсультируйтесь|уточн|индивидуальн)/i.test(body)) score += 5;
    else missing.push('YMYL-ниша без дисклеймера (обязателен для мед/юр/фин)');
  } else {
    score += 5; // не-YMYL — балл не штрафуем
  }

  return { score: Math.min(100, score), missing, signals: { extLinks, words, ymyl: isYmyl() } };
}

export function eeatSummary(mdx) {
  const r = scoreEeat(mdx);
  return `E-E-A-T ${r.score}/100${r.missing.length ? '; нет: ' + r.missing.slice(0, 3).join(', ') : ''}`;
}
