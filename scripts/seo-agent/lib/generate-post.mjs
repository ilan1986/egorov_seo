// Генерация статьи блога (Sonnet 4.6) + очеловечивание + детерминированный фактчек.
import { ask, chat } from './aigate.mjs';
import { checkUniqueness } from './textru.mjs';
import { slugify } from './content.mjs';
import { EXPERT } from '../../../src/consts.ts';

const FORBIDDEN = [
  'в современном мире', 'в эпоху цифровизации', 'не секрет, что', 'важно отметить, что',
  'в заключение', 'подводя итог', 'давайте разберёмся', 'lorem', 'todo', 'placeholder',
];

const SYSTEM = `Ты — опытный налоговый консультант и редактор, пишешь экспертные статьи для сайта бухгалтера
${EXPERT.name} (аттестованный аудитор, ${EXPERT.experienceYears}+ лет). Пишешь живым человеческим русским
языком, без канцелярита, клише и «воды». Конкретно, по делу, с пользой для предпринимателя. Где уместно —
ссылаешься на статьи НК РФ. Точные числовые лимиты/ставки 2026 года, в которых не уверен, помечаешь как
«уточняется по актуальной редакции НК РФ» — не выдумываешь цифры.`;

/** Сгенерировать MDX-статью под ключ. internalLinks: [{title,url}]. */
export async function generatePost({ keyword, category = 'Налоги', internalLinks = [], pubDateISO }) {
  const links = internalLinks.slice(0, 8).map((l) => `- ${l.title}: ${l.url}`).join('\n');
  const prompt = `Напиши экспертную SEO-статью под поисковый запрос: «${keyword}».

Требования к структуре — верни СТРОГО валидный MDX: сначала YAML-фронтматтер между --- , потом тело.

Фронтматтер (поля точно такие):
title: цепляющий заголовок до 60 символов (H1)
seoTitle: title для <title> до 60 символов
description: мета-описание 140–160 символов, с выгодой
pubDate: ${pubDateISO}
author: olga-rudova
category: ${category}
tldr: список из 4–6 кратких фактов для цитирования (с числами и ссылками на статьи НК РФ где уместно)
faq: список из 5 вопросов-ответов (поля q и a)
keywords: 4–6 ключевых фраз
relatedServices: выбери 2–3 РЕЛЕВАНТНЫХ из списка услуг ниже (только slug из URL вида /uslugi/SLUG/)
draft: false

Тело статьи (после фронтматтера):
- объём НЕ МЕНЕЕ 1800 слов, 7–9 разделов H2 с подразделами H3
- структура H2/H3, абзацы живые, разной длины
- минимум один блок <aside class="factbox"> с подзаголовком ### и списком ключевых фактов
- минимум одна таблица в Markdown
- НЕ МЕНЕЕ 3 внутренних ссылок на услуги/статьи из списка ниже (markdown-ссылки [текст](URL))
- ссылки на статьи НК РФ где это по делу
- хотя бы 1 внешняя ссылка на первоисточник (nalog.gov.ru или consultant.ru) на упомянутую норму — для доверия и AI-цитирования
- 1–2 живых вставки от первого лица («на практике у продавцов с оборотом… мы чаще видим…») — против ощущения AI-текста
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

  // Гарантия объёма: ПРАВИЛО — не меньше 1500 слов. Добиваем циклом, пока не хватит.
  let guard = 0;
  while (wordCount(bodyOf(mdx)) < 1600 && guard < 3) {
    guard++;
    const expanded = await ask(
      'Дополни статью до 1900+ слов: добавь конкретики, примеры, разбор частых ошибок и ещё один-два ' +
        'раздела H2. НЕ СОКРАЩАЙ имеющееся. СОХРАНИ фронтматтер и всю разметку (таблицы, factbox, ссылки). ' +
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
  if (words < 1500) issues.push(`мало слов: ${words} (<1500)`);

  const title = fmField(mdx, 'title');
  const desc = fmField(mdx, 'description');
  if (!title) issues.push('нет title');
  else if (title.length > 60) issues.push(`title > 60 (${title.length})`);
  if (!desc) issues.push('нет description');
  else if (desc.length > 165) issues.push(`description > 165 (${desc.length})`);

  const internal = (body.match(/\]\((\/uslugi\/|\/blog\/)[^)]*\)/g) || []).length;
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
        'Оцени фактическую корректность статьи по налогам РФ от 0 до 1. Верни ТОЛЬКО число.',
        body.slice(0, 8000),
        { maxTokens: 10, temperature: 0 }
      );
      confidence = parseFloat(v.replace(',', '.').match(/[0-9.]+/)?.[0] || '0');
      if (confidence < 0.85) issues.push(`LLM confidence ${confidence} (<0.85)`);
    } catch {}
  }

  return { pass: issues.length === 0, issues, words, unique, confidence, title, desc };
}
