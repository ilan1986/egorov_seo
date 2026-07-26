// Генератор llms.txt / llms-full.txt по спецификации llmstxt.org — «карта сайта для нейросетей».
// H1(бренд) + blockquote(описание) + секции (Основное/Статьи/Контакты) со списком ссылок и
// 10-30-словными описаниями. Публикуется в корень сайта при деплое (public/llms.txt).
// Текущий примитивный updateLlmsTxt() в indexnow.mjs заменяется на это.
import { PROFILE } from '../../../site.profile.mjs';

const SITE = (PROFILE.site?.url || PROFILE.siteUrl || '').replace(/\/$/, '');
const GEO = PROFILE.geo || {};

/**
 * @param {Array<{title,url,description?}>} pages — опубликованные статьи (title + urlBase-путь + опис.)
 * @param {object} [opts] — { keyFacts: string[], extraSections: [{name, items:[{title,url,desc}]}] }
 * @returns {string} содержимое llms.txt
 */
export function buildLlmsTxt(pages = [], opts = {}) {
  const brand = GEO.brand || PROFILE.bot?.projectName || SITE;
  const desc = GEO.summary || PROFILE.site?.description || PROFILE.generation?.topicClusters || '';
  const L = [];
  L.push(`# ${brand}`);
  L.push('');
  if (desc) { L.push(`> ${desc.replace(/\s+/g, ' ').trim()}`); L.push(''); }

  // Ключевые факты — то, что нейросети должны знать о проекте (E-E-A-T/сущность)
  const facts = opts.keyFacts || GEO.keyFacts || [];
  if (facts.length) {
    L.push('## Ключевые факты');
    for (const f of facts) L.push(`- ${f}`);
    L.push('');
  }

  // Статьи
  const arts = pages.filter((p) => p && p.url).slice(0, 60);
  if (arts.length) {
    L.push('## Статьи');
    for (const p of arts) {
      const u = /^https?:/.test(p.url) ? p.url : `${SITE}${p.url}`;
      const d = (p.description || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      L.push(`- [${p.title}](${u})${d ? `: ${d}` : ''}`);
    }
    L.push('');
  }

  for (const sec of opts.extraSections || []) {
    if (!sec.items?.length) continue;
    L.push(`## ${sec.name}`);
    for (const it of sec.items) {
      const u = /^https?:/.test(it.url) ? it.url : `${SITE}${it.url}`;
      L.push(`- [${it.title}](${u})${it.desc ? `: ${it.desc}` : ''}`);
    }
    L.push('');
  }

  // Контакты / автор
  const a = GEO.author || {};
  L.push('## Контакты');
  if (a.name) L.push(`- Автор/эксперт: ${a.name}${a.jobTitle ? `, ${a.jobTitle}` : ''}`);
  L.push(`- Сайт: ${SITE}`);
  for (const s of a.sameAs || []) L.push(`- Профиль: ${s}`);
  L.push('');

  return L.join('\n');
}

/** llms-full.txt — тот же индекс + полные тексты статей (для моделей, читающих один файл). */
export function buildLlmsFullTxt(pagesWithBody = []) {
  const brand = GEO.brand || PROFILE.bot?.projectName || SITE;
  const L = [`# ${brand} — полный корпус`, ''];
  for (const p of pagesWithBody.slice(0, 40)) {
    const u = /^https?:/.test(p.url) ? p.url : `${SITE}${p.url}`;
    L.push(`## ${p.title}`, `URL: ${u}`, '', (p.body || '').trim(), '', '---', '');
  }
  return L.join('\n');
}
