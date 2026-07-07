// Генерация статьи блога (Sonnet 4.6) + очеловечивание + детерминированный фактчек.
import { ask, chat } from './aigate.mjs';
import { checkUniqueness } from './uniqueness.mjs';
import { slugify } from './content.mjs';
import { CONFIG } from '../config.mjs';
import { PROFILE } from '../../../site.profile.mjs';

// Все свои urlBase (MDX-коллекции + JSON-справочники) — чем считать ссылку "внутренней".
// Раньше здесь было хардкодом /uslugi/|/blog/ (утечка из nalog-expert) — на сайтах с другими
// urlBase (напр. novostroyki: /stati/, /novostroyki/, /zastroyshchiki/, /raiony/) фактчек всегда
// находил 0 внутренних ссылок, даже если LLM честно их вставлял по промпту.
const INTERNAL_URL_BASES = [
  ...PROFILE.content.collections.map((c) => c.urlBase),
  ...(PROFILE.content.linkCatalogs || []).map((c) => c.urlBase),
];

const FORBIDDEN = [
  'в современном мире', 'в эпоху цифровизации', 'не секрет, что', 'важно отметить, что',
  'в заключение', 'подводя итог', 'давайте разберёмся', 'lorem', 'todo', 'placeholder',
];

// Голос/экспертиза/бренд — целиком из профиля сайта (site.profile.mjs), core не решает, кто перед ним.
const SYSTEM = PROFILE.generation.systemPrompt;

/** Сгенерировать MDX-статью под ключ. internalLinks: [{title,url}]. lsi/paa — данные Arsenkin (опц.). */
export async function generatePost({ keyword, category = PROFILE.generation.defaultCategory, internalLinks = [], pubDateISO, lsi = [], paa = [] }) {
  const links = internalLinks.slice(0, 8).map((l) => `- ${l.title}: ${l.url}`).join('\n');
  const lsiBlock = lsi.length
    ? `\n\nТЕМАТИЧЕСКИЕ ТЕРМИНЫ (Яндекс выделяет их в топ-10 — органично впиши по смыслу, без переспама): ${lsi.slice(0, 25).join(', ')}.`
    : '';
  const paaBlock = paa.length
    ? `\n\nРЕАЛЬНЫЕ ВОПРОСЫ ПОЛЬЗОВАТЕЛЕЙ (используй их в поле faq, ответы дай экспертно своими словами): ${paa.slice(0, 6).map((q) => q).join(' | ')}`
    : '';
  const prompt = `Напиши экспертную SEO-статью под поисковый запрос: «${keyword}».${lsiBlock}${paaBlock}

Требования к структуре — верни СТРОГО валидный MDX: сначала YAML-фронтматтер между --- , потом тело.

Фронтматтер (поля точно такие):
title: цепляющий заголовок до 60 символов (H1)
seoTitle: title для <title> до 60 символов
description: мета-описание 140–160 символов, с выгодой
pubDate: ${pubDateISO}
category: ${category}
tldr: список из 4–6 кратких фактов для цитирования (с числами и ссылками на первоисточники где уместно)
faq: список из 5 вопросов-ответов (поля q и a)
keywords: 4–6 ключевых фраз
draft: false${PROFILE.generation.extraFrontmatter ? `\n${PROFILE.generation.extraFrontmatter}` : ''}

Тело статьи (после фронтматтера):
- объём НЕ МЕНЕЕ 1800 слов, 7–9 разделов H2 с подразделами H3
- структура H2/H3, абзацы живые, разной длины
- минимум один блок <aside class="factbox"> с подзаголовком ### и списком ключевых фактов
- минимум одна таблица в Markdown
- НЕ МЕНЕЕ 3 внутренних ссылок на услуги/статьи из списка ниже (markdown-ссылки [текст](URL))${PROFILE.generation.authoritySourcesHint ? `\n- ${PROFILE.generation.authoritySourcesHint}` : ''}
- 1–2 живых вставки от первого лица («на практике у клиентов с похожим запросом… мы чаще видим…») — против ощущения AI-текста
- без клише, без «воды», без вступлений ни о чём
- Разметка — обычный Markdown. Единственный разрешённый HTML — врезка <aside class="factbox">…</aside> (с подзаголовком ### внутри). НЕ добавляй import/export и НЕ используй JSX-компоненты. Знаки сравнения пиши словами: «менее», «не более», «до», «свыше», «более».

Доступные внутренние ссылки (используй релевантные, минимум 3):
${links}

Верни ТОЛЬКО MDX, без пояснений и без markdown-обёртки \`\`\`.`;

  let mdx = await ask(SYSTEM, prompt, { maxTokens: 8000, temperature: 0.7 });
  mdx = mdx.replace(/^```(mdx|markdown)?\n?/i, '').replace(/\n?```$/i, '').trim();

  // Очеловечивание (убрать клише, НЕ сокращая объём)
  const cleaned = await ask(
    'Ты редактор. Сделай язык живым и человеческим, убери канцелярит и клише. ' +
      'НЕ СОКРАЩАЙ объём текста — он должен остаться прежним или больше. ' +
      'СОХРАНИ фронтматтер, всю разметку, таблицы, ссылки и факты. Верни только готовый MDX.',
    mdx,
    { maxTokens: 8000, temperature: 0.4 }
  ).catch(() => mdx);
  mdx = cleaned.replace(/^```(mdx|markdown)?\n?/i, '').replace(/\n?```$/i, '').trim();

  // Гарантия объёма: публикуем от 1300 слов (см. factcheckPost) — добиваем только до 1500,
  // не до 1900+, и не более 2 попыток, чтобы не жечь баланс aigate.shop на бесконечных дожимах
  // пограничных статей (было: цель 1600/до 3 попыток — расточительно для статей уже близких к порогу).
  let guard = 0;
  while (wordCount(bodyOf(mdx)) < 1500 && guard < 2) {
    guard++;
    const expanded = await ask(
      'Дополни статью до 1500+ слов: добавь конкретики, примеры, разбор частых ошибок и, если нужно, ещё ' +
        'один раздел H2. НЕ СОКРАЩАЙ имеющееся. СОХРАНИ фронтматтер и всю разметку (таблицы, factbox, ссылки). ' +
        'Без import и JSX-компонентов, сравнения пиши словами. Верни весь MDX целиком.',
      mdx,
      { maxTokens: 9000, temperature: 0.6 }
    ).catch(() => mdx);
    mdx = expanded.replace(/^```(mdx|markdown)?\n?/i, '').replace(/\n?```$/i, '').trim();
  }

  mdx = sanitizeMdx(mdx);
  const slug = deriveSlug(mdx, keyword);
  return { slug, mdx };
}

/** Привести тело к безопасному для MDX-сборки виду. */
export function sanitizeMdx(mdx) {
  const m = mdx.match(/^(---\n[\s\S]*?\n---\n)([\s\S]*)$/);
  const head = m ? m[1] : '';
  let body = m ? m[2] : mdx;
  // 1) убрать галлюцинированные ESM import/export (ломают сборку)
  body = body.replace(/^[ \t]*(import|export)\s.*$/gm, '');
  // 2) убрать парные JSX-компоненты <Component>…</Component> (с заглавной)
  body = body.replace(/<([A-Z][A-Za-z0-9]*)\b[^>]*>[\s\S]*?<\/\1>/g, '');
  // 3) убрать самозакрывающиеся JSX-компоненты <Component ... />
  body = body.replace(/<[A-Z][A-Za-z0-9]*\b[^>]*\/>/g, '');
  // 4) экранировать < и >, не относящиеся к html-тегам
  body = body.replace(/<(?![a-zA-Z/!])/g, '&lt;');
  body = body.replace(/>(?=\s*\d)/g, '&gt;');
  // 5) схлопнуть тройные пустые строки
  body = body.replace(/\n{3,}/g, '\n\n');
  return head + body;
}

function wordCount(body) {
  return body.replace(/[#>*`\-|\[\]()]/g, ' ').split(/\s+/).filter(Boolean).length;
}

function deriveSlug(mdx, keyword) {
  const t = mdx.match(/^title:\s*(.+)$/m)?.[1]?.replace(/^["']|["']$/g, '') || keyword;
  return slugify(t || keyword);
}

function bodyOf(mdx) {
  const m = mdx.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return m ? m[1] : mdx;
}
function fmField(mdx, name) {
  return mdx.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '').trim() || '';
}

/** Детерминированный фактчек + уникальность + уверенность LLM. */
export async function factcheckPost(mdx, { minUnique = 82, checkUnique = true } = {}) {
  const issues = [];
  const body = bodyOf(mdx);
  const words = body.replace(/[#>*`\-|\[\]()]/g, ' ').split(/\s+/).filter(Boolean).length;
  // Порог снижен с 1500 до 1300 (06.07.2026): жёсткий 1500 гонял генерацию по кругу на пограничных
  // статьях (1300-1499 слов бесполезно перегенерировались заново вместо публикации) — лишний расход
  // aigate.shop без реальной пользы для читателя.
  if (words < 1300) issues.push(`мало слов: ${words} (<1300)`);

  const title = fmField(mdx, 'title');
  const desc = fmField(mdx, 'description');
  if (!title) issues.push('нет title');
  else if (title.length > 60) issues.push(`title > 60 (${title.length})`);
  if (!desc) issues.push('нет description');
  else if (desc.length > 165) issues.push(`description > 165 (${desc.length})`);

  const basesPattern = INTERNAL_URL_BASES.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const internal = basesPattern ? (body.match(new RegExp(`\\]\\((${basesPattern})[^)]*\\)`, 'g')) || []).length : 0;
  if (internal < 3) issues.push(`мало внутренних ссылок: ${internal} (<3)`);

  if (!/class="factbox"/.test(body)) issues.push('нет блока factbox');
  if (!/\|.*\|/.test(body)) issues.push('нет таблицы');

  const low = mdx.toLowerCase();
  const bad = FORBIDDEN.filter((p) => low.includes(p));
  if (bad.length) issues.push(`клише/плейсхолдеры: ${bad.join(', ')}`);

  let unique = null;
  if (checkUnique && issues.length === 0) {
    try {
      const r = await checkUniqueness(body.slice(0, 12000), { tries: 25, delayMs: 6000 });
      unique = r.unique;
      if (unique != null && unique < minUnique) issues.push(`уникальность ${unique}% (<${minUnique}%)`);
    } catch (e) {
      issues.push(`text.ru: ${e.message}`);
    }
  }

  // Уверенность LLM в фактической корректности
  let confidence = null;
  if (issues.length === 0) {
    try {
      const v = await ask(
        PROFILE.generation.factcheckPrompt,
        body.slice(0, 8000),
        { maxTokens: 10, temperature: 0 }
      );
      confidence = parseFloat(v.replace(',', '.').match(/[0-9.]+/)?.[0] || '0');
      const minConf = CONFIG.agent.minConfidence;
      if (confidence < minConf) issues.push(`LLM confidence ${confidence} (<${minConf})`);
    } catch {}
  }

  return { pass: issues.length === 0, issues, words, unique, confidence, title, desc };
}
