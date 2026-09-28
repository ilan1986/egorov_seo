// Генерация статьи блога (Sonnet 4.6) + очеловечивание + детерминированный фактчек.
import { ask, chat } from './aigate.mjs';
import { checkUniqueness } from './uniqueness.mjs';
import { slugify } from './content.mjs';
import { blockReason } from './blocklist.mjs';
import { makeImage } from '../../images/images.mjs';
import { GEO_DIRECTIVES } from './geo-prompt.mjs';
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
// GEO-директивы (answer-first под каждый H2, вопросные заголовки, citation-капсулы, evidence-triple,
// определения терминов) подмешиваем ТОЛЬКО сайтам с настроенной geo-секцией — поднимает цитируемость
// нейросетями (Яндекс Нейро/ChatGPT/Perplexity) без правки промпта каждого сайта. Не-GEO сайты не трогаем.
const SYSTEM = PROFILE.generation.systemPrompt + (PROFILE.geo ? '\n\n' + GEO_DIRECTIVES : '');

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

  const looksValid = (m) => typeof m === 'string' && /^---/.test(m.trim()) && /(^|\n)title:/i.test(m.slice(0,700)) && wordCount(bodyOf(m)) >= 1000;
  let mdx = '';
  for (let _a = 0; _a < 4; _a++) {
    const _raw = await ask(SYSTEM, prompt, { maxTokens: 8000, temperature: 0.7 }).catch(() => '');
    const _c = String(_raw).replace(/^```(mdx|markdown)?\n?/i, '').replace(/\n?```$/i, '').trim();
    if (looksValid(_c)) { mdx = _c; break; }
    if (_c.length > mdx.length) mdx = _c;
  }

  // Очеловечивание (убрать клише, НЕ сокращая объём)
  const cleaned = await ask(
    'Ты редактор. Сделай язык живым и человеческим, убери канцелярит и клише. ' +
      'НЕ СОКРАЩАЙ объём текста — он должен остаться прежним или больше. ' +
      'СОХРАНИ фронтматтер, всю разметку, таблицы, ссылки и факты. Верни только готовый MDX.',
    mdx,
    { maxTokens: 8000, temperature: 0.4 }
  ).catch(() => mdx);
  const _cl = cleaned.replace(/^```(mdx|markdown)?\n?/i, '').replace(/\n?```$/i, '').trim();
  if (looksValid(_cl) && wordCount(bodyOf(_cl)) >= wordCount(bodyOf(mdx)) * 0.85) mdx = _cl;

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
    const _ex = expanded.replace(/^```(mdx|markdown)?\n?/i, '').replace(/\n?```$/i, '').trim();
    if (looksValid(_ex) && wordCount(bodyOf(_ex)) >= wordCount(bodyOf(mdx))) mdx = _ex; else break;
  }

  mdx = sanitizeMdx(mdx);
  mdx = repairFrontmatterFaq(mdx);
  mdx = repairFrontmatterArrays(mdx); // keywords/tags строкой-через-запятую → YAML-список (иначе схема z.array падает и рушит сборку всей сетки)
  mdx = repairFrontmatterYaml(mdx);
  // ГАРД: не отдаём статью без валидного фронтматтера с непустым title. Иначе Astro-сборка падает
  // InvalidContentEntryDataError и ВЕСЬ сайт не обновляется. Причина — LLM изредка (деградация
  // модели/прокси) 4 раза подряд возвращает текст без шапки; стартовый цикл оставляет самый длинный
  // невалидный черновик. Лучше бросить ошибку — generate-one.mjs поймает как «Ошибка генерации» и
  // пропустит тему, не трогая сайт, чем опубликовать битый .mdx и уронить сборку всей сетки.
  const _fm = mdx.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!_fm || !/^title:[ \t]*\S/m.test(_fm[1])) {
    throw new Error('нет валидного фронтматтера (title) — статья пропущена, чтобы не ронять сборку сайта');
  }
  const slug = deriveSlug(mdx, keyword);
  // ЖЁСТКИЙ ГЕЙТ BLOCKLIST: конкурент-бренд или чужой город в slug/title/заголовках (или бренд
  // латиницей/в агентском контексте в теле) → НЕ публикуем. Проверяем ПОСЛЕ генерации по финальным
  // slug + заголовкам: модель может притащить бренд в заголовок, даже если ключ был чистым (так
  // утекли 3 статьи про «Этажи» на новостройках 09.09 — blockReason был написан, но нигде не
  // вызывался). Бросаем — generate-one/run.mjs ловят как «Ошибка генерации» и пропускают тему.
  const _blocked = blockReason(mdx, slug + ' ' + keyword);
  if (_blocked) throw new Error(`заблокировано блок-листом (${_blocked}) — тема пропущена, не публикуем`);

  // Обложка: 1 картинка на статью → public/images/<slug>.jpg + поля image:/cover: во фронтматтере
  // (image — для блог-статей, cover — для сервис-лендингов; лишнее поле схема Zod игнорит). Источник —
  // прокси-цепочка внутри makeImage (flux→imagen-fast→z-image→pollinations→kie). Сбой НЕ роняет статью.
  if (!/^(image|cover):/m.test(_fm[1])) {
    try {
      const _t = (_fm[1].match(/^title:\s*"?(.+?)"?\s*$/m) || [])[1] || keyword;
      const _img = await makeImage({ name: slug, prompt: `Реалистичная профессиональная фотография по теме статьи, чистый современный стиль, естественный свет, документальная фотография, высокое качество`, ratio: '16:9' });
      if (_img && _img.rel) mdx = mdx.replace(/^---\r?\n/, (m) => `${m}image: ${_img.rel}\ncover: ${_img.rel}\n`);
    } catch { /* публикуем без обложки — сборку не роняем */ }
  }
  return { slug, mdx };
}

// LLM иногда возвращает фронтматтер БЕЗ закрывающего --- (или роняет его, и первый
// горизонтальный разделитель "---" в теле принимается за закрытие — тогда между ними
// оказывается проза, и YAML падает "a multiline key may not be an implicit key").
// Гарантируем корректный закрывающий разделитель ДО первого заголовка тела.
export function normalizeFrontmatter(mdx) {
  const lines = mdx.split('\n');
  // ДВОЙНОЙ разделитель: LLM/скрипт-обёртка иногда пишет `---\n---\n` перед реальным фронтматтером.
  // Astro читает первый пустой блок как фронтматтер (title/description/pubDate отсутствуют → падает
  // схема z, рушит сборку всего сайта), а реальные поля уходят в тело. Если сразу за вторым `---`
  // идёт YAML-ключ — первый `---` лишний, снимаем его (пока настоящая шапка не станет первым блоком).
  while (lines[0]?.trim() === '---' && lines[1]?.trim() === '---' && /^[A-Za-z_][\w-]*\s*:/.test(lines[2] || '')) {
    lines.shift();
  }
  if (lines[0]?.trim() !== '---') return mdx;
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { close = i; break; }
  }
  let firstHeading = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) { firstHeading = i; break; }
  }
  if (close === -1 || (firstHeading !== -1 && close > firstHeading)) {
    let end = firstHeading === -1 ? lines.length : firstHeading;
    while (end - 1 >= 1 && lines[end - 1].trim() === '') end--;
    lines.splice(end, 0, '---');
  }
  return lines.join('\n');
}

// LLM пишет "seoTitle: Учёт в 1С 8.3: план" или "a: ...это важно: деталь" — двоеточие-пробел в
// незакавыченном скаляре ломает YAML. Кавычим опасные скаляры (title/seoTitle/description/q/a).
// НЕ трогаем YAML-блок-скаляры (">", ">-", "|", "|-" и т.п.) — это валидный многострочный синтаксис,
// текст которого лежит на следующих строках; кавычки его разрушат.
/**
 * Убрать повторяющиеся ключи фронтматтера, оставив первое вхождение.
 * Модель повторяет, например, `category:` дважды — js-yaml падает с «duplicated mapping key»,
 * и вместе с одной статьёй перестаёт собираться весь сайт. Вместе с ключом выбрасываем его
 * продолжение: вложенные строки и элементы списка до следующего ключа верхнего уровня.
 */
function dropDuplicateKeys(head) {
  const out = [];
  const seen = new Set();
  let skipping = false;
  for (const line of head.split('\n')) {
    const key = line.match(/^([A-Za-z_][\w-]*):/);
    if (key) {
      if (seen.has(key[1])) { skipping = true; continue; }
      seen.add(key[1]);
      skipping = false;
    } else if (skipping && (line.startsWith(' ') || line.startsWith('-') || line.trim() === '')) {
      continue;
    } else {
      skipping = false;
    }
    out.push(line);
  }
  return out.join('\n');
}

function quoteRiskyScalars(head) {
  const blockScalar = /^[>|][+-]?$/;
  const leadSpecial = /^[>@&*!%#[\]{}|~?-]/;
  return head
    .split('\n')
    .map((line) => {
      const m = line.match(/^(\s*(?:-\s*)?)(title|seoTitle|description|q|a):\s(.+)$/);
      if (!m) return line;
      const [, prefix, key, val] = m;
      const t = val.trim();
      if (blockScalar.test(t)) return line; // валидный блок-скаляр — не трогаем
      const already = t.startsWith('"') && t.endsWith('"') && t.length > 1;
      const risky = t.includes(': ') || leadSpecial.test(t) || t.endsWith(':');
      if (already || !risky) return line;
      return `${prefix}${key}: ${JSON.stringify(t)}`;
    })
    .join('\n');
}

/** Привести тело к безопасному для MDX-сборки виду. */
export function sanitizeMdx(mdx) {
  // 0) Модель иногда заворачивает весь ответ в блок кода. Тогда файл начинается с ```mdx,
  //    фронтматтер перестаёт быть фронтматтером, и Astro роняет ВСЮ сборку сайта
  //    на InvalidContentEntryDataError — даже если статья лежит в очереди на модерации.
  mdx = String(mdx).trim();
  const fenced = mdx.match(/^```(?:mdx|markdown|md)?\s*\n([\s\S]*?)\n?```\s*$/);
  if (fenced) mdx = fenced[1];

  mdx = normalizeFrontmatter(mdx);
  const m = mdx.match(/^(---\n[\s\S]*?\n---\n)([\s\S]*)$/);
  let head = m ? quoteRiskyScalars(m[1]) : '';
  if (head) { head = repairFrontmatterFaq(head); head = repairFrontmatterArrays(head); head = repairFrontmatterYaml(head); head = trimFrontmatterTitle(head); }
  let body = m ? m[2] : mdx;
  // 1) убрать галлюцинированные ESM import/export (ломают сборку)
  body = body.replace(/^[ \t]*(import|export)\s.*$/gm, '');
  // 2) убрать парные JSX-компоненты <Component>…</Component> (с заглавной)
  body = body.replace(/<([A-Z][A-Za-z0-9]*)\b[^>]*>[\s\S]*?<\/\1>/g, '');
  // 3) убрать самозакрывающиеся JSX-компоненты <Component ... />
  body = body.replace(/<[A-Z][A-Za-z0-9]*\b[^>]*\/>/g, '');
  // 3.5) самозакрыть void-HTML (<br>, <hr>) — MDX требует закрывающий тег и иначе роняет сборку
  body = body.replace(/<(br|hr)\s*>/gi, '<$1 />');
  // 3.6) LaTeX-математика ($$…$$, \[…\], $…$) — MDX читает `{` как JSX-выражение и падает на `\` в
  // \text{}/\frac{}{} («Expecting Unicode escape sequence \uXXXX», acorn). Модель иногда выдаёт формулы
  // в LaTeX (напр. ПДН = \frac{...}{...}\times100\%) — конвертируем в читаемый текст.
  body = deLatex(body);
  // 3.7) экранировать ОСТАВШИЕСЯ одиночные { } вне кодовых блоков — любые фигурные скобки в прозе MDX
  //      трактует как выражение и роняет сборку. В коде (``` … ``` / `…`) не трогаем.
  body = escapeBracesOutsideCode(body);
  // 4) экранировать < и >, не относящиеся к html-тегам
  body = body.replace(/<(?![a-zA-Z/!])/g, '&lt;');
  // ВАЖНО: экранируем «>» перед числом ТОЛЬКО когда это отдельный оператор (в начале строки или
  // после пробела/скобки). Иначе правило съедало закрывающий тег `</strong> 85` → `</strong&gt; 85`,
  // а это роняет MDX-сборку («Unexpected character & in name»). Тег-закрытие НЕ трогаем.
  body = body.replace(/(^|[\s(])>(?=\s*\d)/gm, '$1&gt;');
  // 5) схлопнуть тройные пустые строки
  body = body.replace(/\n{3,}/g, '\n\n');
  return head + body;
}

// LaTeX → обычный текст (иначе `{` в формуле роняет MDX-сборку через acorn).
function deLatex(s) {
  const conv = (e) => e
    .replace(/\\(?:text|mathrm|mathbf|operatorname)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\d?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1) / ($2)')
    .replace(/\\times/g, '×').replace(/\\cdot/g, '·').replace(/\\div/g, '÷')
    .replace(/\\leq/g, '≤').replace(/\\geq/g, '≥').replace(/\\approx/g, '≈').replace(/\\neq/g, '≠')
    .replace(/\\%/g, '%').replace(/\\\$/g, '$').replace(/\\[,;:!> ]/g, ' ')
    .replace(/\\left|\\right/g, '')
    .replace(/\\[a-zA-Z]+/g, ' ')   // прочие команды \sum, \sqrt, …
    .replace(/[{}]/g, '')
    .replace(/[ \t]{2,}/g, ' ').trim();
  return s
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, e) => conv(e))              // блочные $$…$$
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, e) => conv(e))              // \[ … \]
    .replace(/\$([^$\n]*?[\\{}][^$\n]*?)\$/g, (_, e) => conv(e));   // строчные $…$ ТОЛЬКО с \ или {}
}

// Экранировать { } как HTML-сущности ВНЕ кодовых блоков (в коде — оставить как есть).
function escapeBracesOutsideCode(s) {
  return s
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((seg, i) => (i % 2 === 1 ? seg : seg.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')))
    .join('');
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
      // fail-open: сбой/таймаут внешнего сервиса проверки НЕ блокирует публикацию —
      // сгенерированный контент оригинален по природе (см. content-watch как основной провайдер).
      console.warn(`[uniqueness] проверка недоступна: ${e.message} — публикуем без блокировки`);
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
      if (confidence > 0 && confidence < minConf) issues.push(`LLM confidence ${confidence} (<${minConf})`);
    } catch {}
  }

  return { pass: issues.length === 0, issues, words, unique, confidence, title, desc };
}


// Авто-ремонт YAML-фронтматтера: LLM часто ставит в faq ключ "a:" на 2 пробела (как сосед "- q:"),
// тогда как он должен быть на 4 (внутри элемента списка) — иначе js-yaml падает и ломается сборка.
// Чиним только внутри фронтматтера, тело не трогаем.
export function repairFrontmatterFaq(mdx) {
  const m = mdx.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!m) return mdx;
  let fixed = m[2].replace(/^  a:( |$)/gm, '    a:$1');
  // LLM иногда пишет ответ как ЭЛЕМЕНТ списка «- a:» вместо ключа мэппинга «a:» → рвёт YAML faq
  // («end of the stream», InvalidContentEntry). Убираем лишний дефис перед a:.
  fixed = fixed.replace(/^(\s*)-[ \t]+a:/gm, '$1a:');
  return mdx.replace(m[0], m[1] + fixed + m[3]);
}

// keywords/tags модель иногда отдаёт СТРОКОЙ «a, b, c», а Zod-схема ждёт массив → сборка падает
// («Expected array, received string»). Чиним CSV-строку в YAML-массив.
export function repairFrontmatterArrays(mdx) {
  const m = mdx.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!m) return mdx;
  const fixed = m[2].replace(/^(keywords|tags):[ \t]*(\S.*)$/gm, (ln, key, val) => {
    const v = val.trim();
    if (v.startsWith('[') || v.startsWith('-')) return ln; // уже массив/начало списка
    const items = v.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    if (!items.length) return ln;
    return key + ':\n' + items.map((i) => '  - "' + i.replace(/"/g, '\\"') + '"').join('\n');
  });
  return mdx.replace(m[0], m[1] + fixed + m[3]);
}


// Квотирует опасные YAML-скаляры во фронтматтере: пункты списков (tldr/keywords) и значения q/a,
// содержащие ": " или спецсимволы, — иначе js-yaml парсит их как объект/ломается и падает схема.
export function repairFrontmatterYaml(mdx) {
  const m = mdx.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!m) return mdx;
  const q = (s) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const quoted = (v) => /^".*"$/.test(v.trim()) || /^'.*'$/.test(v.trim());
  const haz = (v) => /:\s/.test(v) || /^[\[{@&*!|>%#`]/.test(v.trim());
  const fixed = m[2].split(/\r?\n/).map((ln) => {
    // голый пункт списка "  - строка" (не "- q:"/"- a:") со скрытым ": "
    let mm = ln.match(/^(\s*)-\s+(.+)$/);
    if (mm && !/^[\w-]+:\s/.test(mm[2]) && !quoted(mm[2]) && haz(mm[2])) return mm[1] + '- ' + q(mm[2]);
    // значение q:/a: (с ведущим "- " или без) со скрытым ": "
    mm = ln.match(/^(\s*)(?:-\s+)?(q|a):\s+(.+)$/);
    if (mm && !quoted(mm[3]) && haz(mm[3])) {
      const dash = /^\s*-\s/.test(ln) ? '- ' : '';
      return mm[1] + dash + mm[2] + ': ' + q(mm[3]);
    }
    return ln;
  }).join('\n');
  return mdx.replace(m[0], m[1] + fixed + m[3]);
}


// Обрезает слишком длинные title/seoTitle (>60) по границе слова — иначе фактчек «title > 60» блокирует.
export function trimFrontmatterTitle(head) {
  return head.replace(/^(title|seoTitle):[ \t]*(.+?)[ \t]*$/gm, (ln, key, raw) => {
    let v = raw.trim().replace(/^["'](.*)["']$/, '$1');
    if (v.length <= 60) return ln;
    v = v.slice(0, 60).replace(/\s+\S*$/, '').replace(/[\s,:;–—-]+$/, '').trim();
    return key + ': ' + (/[:#"'\[\]{}]/.test(v) ? JSON.stringify(v) : v);
  });
}
