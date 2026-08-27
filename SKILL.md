---
name: egorov_seo
description: >-
  Автономный SEO/GEO контент-агент для русскоязычных сайтов (общее ядро seo-agent-core). Разворачивает
  и эксплуатирует систему, которая САМА собирает семантику (включая реальный спрос из Яндекс.Вебмастера,
  не только текущие показы), генерирует экспертные статьи (1300-1500+ слов, гибкий порог) через
  aigate/Sonnet, очеловечивает, проверяет уникальность (content-watch/text.ru), генерирует картинки
  (Pollinations.ai бесплатно → kie.ai резерв), публикует на сайт (Astro→FTP), шлёт на переобход в
  Яндекс.Вебмастер + IndexNow, ведёт учёт расходов по всем платным API (cost-ledger) и присылает
  ежедневный отчёт (трафик/источники/страницы/позиции/расходы) в Telegram/MAX. Сайт адаптируется
  декларативно через `site.profile.mjs` (тип сайта, коллекции контента, голос бренда, CTA) — без
  правки кода ядра. Поддерживает массовую батч-генерацию в очередь и публикацию по N статей в день
  по cron. Используй, когда нужно: поставить сайт на SEO-автопилот, нагенерить пакет статей по
  семантическому ядру, расширить тонкие тексты, подключить Вебмастер/Метрику/content-watch/xmlstock/
  kie.ai, развернуть бота заявок+диалога и ежедневный отчёт, или склонировать эту систему под новый
  сайт/нишу. GEO-модуль: скорер цитируемости (`lib/citability.mjs`), генератор JSON-LD @graph
  Article/FAQPage/Person/speakable (`lib/schema.mjs`), llms.txt по спеке (`lib/llmstxt.mjs`), robots.txt
  для AI-ботов, раздел `geo` в профиле, LLM-планировщик приоритетов (`lib/planner.mjs`) — превращает
  линейный прогон в агента. Триггеры: «seo агент», «egorov_seo», «контент-автопилот», «нагенери статьи по
  семантике», «расширь тексты», «публикуй по 5 в день», «ежедневный отчёт», «GEO», «оптимизация под
  нейросети», «цитирование нейросетями», «schema», «llms.txt», «citability», «политика конфиденциальности»,
  «152-ФЗ», «cookie-баннер», «согласие на обработку персональных данных». Юр-комплаенс РФ (152-ФЗ):
  раздел `legal` в профиле + шаблоны `scripts/templates/` (страница политики текстом, cookie-баннер с
  гейтингом Метрики до согласия, чекбокс согласия на формах, реквизиты оператора в подвал) —
  разворачивается на каждом новом сайте.
---

# egorov_seo — автономный SEO/GEO контент-агент

Система, которая ведёт SEO-контент сайта без участия человека: собирает данные, генерирует статьи,
проверяет, публикует, переобходит, отчитывается. Ядро (`scripts/`) сайт-агностично — под конкретный
сайт оно адаптируется ОДНИМ файлом `site.profile.mjs` в корне проекта, без правки кода ядра.

**Этот пакет — офлайн-снапшот эталона `seo-agent-core` для установки на НОВЫЙ сайт с нуля.** Если у
тебя уже есть свой git-эталон seo-agent-core (VPS bare-repo + fanout по сайтам) — этот скилл не
участвует в той цепочке автоматически; периодически пересинхронизируй его вручную (скопировать
`scripts/` + `site.profile.example.mjs` + `.env.example` заново), когда в эталоне накопятся правки.

## Архитектура (разделение хостинга)

- **Сайт** — статика Astro, лежит на дешёвом РФ-хостинге (Reg.ru, FTP). Не требует Node.
- **Агент + бот** — на VPS (Node 18+, pm2, python3). Агент собирает сайт локально на VPS и
  заливает по FTP на хостинг. Заявки с формы идут через PHP-форвардер на самом хостинге (см. ниже),
  поэтому приём лидов НЕ зависит от VPS.

## `site.profile.mjs` — контракт адаптации под сайт (ГЛАВНОЕ)

Ядро само по себе не знает, чей это сайт. Всё специфичное для сайта — в одном файле в корне проекта
(рядом с `astro.config.mjs`), см. `site.profile.example.mjs`:

- `siteType` — `expert` (эксперт-персона) / `org` (организация/медагрегатор) / `catalog` (каталог объектов).
- `content.collections[]` — MDX-коллекции сайта: `{name, dir, urlBase, isTarget}` (ровно одна
  `isTarget: true` — куда агент пишет статьи). URL публикуемых статей ВСЕГДА берутся отсюда
  (`targetUrlBase()` в `lib/content.mjs`) — никогда не хардкодь `/blog/` или любой другой путь в
  своих правках, это ломается на любом сайте с другой структурой урлов.
- `content.linkCatalogs[]` *(опционально)* — справочники НЕ на MDX (напр. карточки объектов каталога
  в JSON: ЖК, застройщики, товары). Не участвуют в дедупе тем генератора, но дают пул внутренних
  ссылок. **Обязательно нужно на каталожных сайтах**, где `isTarget`-коллекция стартует пустой —
  иначе фактчек ВСЕГДА отклоняет статьи за нехватку внутренних ссылок (линковать не на что), и это
  выглядит как зависание/баг, хотя на самом деле пул пуст.
- `generation.systemPrompt/topicClusters/factcheckPrompt/authoritySourcesHint` — голос, экспертиза,
  ниша бренда. Ядро само не решает, кто перед ним — всё из профиля.
- `bot.systemPrompt/projectName` — контекст и бренд для Telegram/MAX-бота.
- `cta.anchor/renderBlock` — что вставлять как призыв к действию в статьях.

⚠️ **Astro-специфичная ловушка, не связанная с агентом**: если `isTarget`-коллекция читает `.mdx`
файлы, в проекте ДОЛЖНА быть подключена интеграция `@astrojs/mdx` (`npm i @astrojs/mdx`, добавить
`mdx()` в `integrations` в `astro.config.mjs`). Без неё Astro Content Layer молча пишет `[WARN] No
entry type found for *.mdx` и коллекция считается пустой при сборке — ни одна статья не станет
страницей сайта, сколько бы агент их ни генерировал. Проверяется одной командой:
`npm run build 2>&1 | grep -i mdx` — если видишь этот warning, интеграции нет.

## Воркфлоу агента (`scripts/seo-agent/run.mjs`) — 6 шагов

1. **Сбор данных**: существующие страницы (покрытие тем), Я.Вебмастер (реальные запросы/позиции +
   **DEMAND** — рыночный спрос по запросу независимо от текущей видимости сайта, см. `demandGaps()`
   в `lib/ctr-optimize.mjs`), Я.Метрика (трафик/поведение), xmlstock (SERP/конкуренция), Arsenkin
   (LSI/Wordstat/PAA — опц.).
2. **Расширение ключей**: Sonnet генерит long-tail запросы по кластерам ниши (из `site.profile.mjs`), дедуп против покрытого.
3. **Gap-анализ**: ключи без страницы → оценка лёгкости входа (xmlstock) + Wordstat-частотность +
   **бонус за высокий DEMAND без кликов** → топ-N кандидатов.
4. **Генерация + проверки** (`lib/generate-post.mjs`): Sonnet 4.6 → очеловечивание → **цикл добивания
   объёма до 1500 слов (не более 2 попыток)** → детерминированный фактчек (слов≥1300 — гибкий порог,
   не жёсткие 1500: избегает бесконечной перегенерации пограничных статей и лишнего расхода
   aigate.shop, см. «Правила и грабли»; title≤60, desc≤165, internalLinks≥3 **по urlBase из
   site.profile.mjs**, factbox, таблица, нет клише/плейсхолдеров) + **уникальность ≥82%**
   (content-watch основной провайдер → text.ru резерв) + LLM confidence ≥порога.
5. **Картинки**: Pollinations.ai (бесплатно, без ключа) как основной провайдер → kie.ai Nano Banana 2
   как молчаливый резерв при отказе (`lib/images.mjs`/`scripts/images/images.mjs`).
6. **Публикация** (только live, `DRY_RUN=false`): запись MDX в `isTarget`-коллекцию → `npm run build`
   → FTP-деплой → Я.Вебмастер recrawl + IndexNow → обновление `llms.txt` → запись в used-queries.
7. **Учёт расходов** (`lib/cost-ledger.mjs`): каждый платный вызов aigate (генерация/диалог — реальная
   `usage.cost_usd` из ответа, не оценка по токенам) логируется в JSON-файл дня; Arsenkin/xmlstock
   считаются по числу вызовов (нет балансового API).
8. **Мониторинг + отчёт в Telegram** (создано/пропущено/ошибки/в топ-30/осталось в очереди) +
   опционально дублирующее уведомление о заявках в MAX.
9. **Ежедневный сводный отчёт** (`daily-report.mjs`, по отдельному cron в 12:00 МСК): Трафик за
   сегодня + разбивка по источникам (прямой/поиск/ссылки/мессенджеры), число проиндексированных
   страниц + дельта, позиции топ10/50/100 + тренд (▲/▼/🆕 против прошлого отчёта), рекомендации,
   расходы в $ по сервисам за день.

## Два режима работы run.mjs

- **Очередь** (если `data/queue/` не пуста): берёт до `MAX_NEW` статей/день из очереди, гоняет
  проверку уникальности только на них, ставит дату=сегодня, публикует. Экономит платные проверки.
- **Живая генерация** (очередь пуста): генерит сам по gap-анализу.

## GEO-модуль (оптимизация под цитирование нейросетями)

Надстройка над SEO: делает контент таким, чтобы нейросети (Яндекс Нейро, ChatGPT, Perplexity, Gemini)
брали его в ответ и указывали сайт как источник. Настраивается разделом `geo` в `site.profile.mjs`
(бренд, автор с `sameAs`/`knowsAbout`, ключевые факты, целевые площадки, probe-вопросы) — код ядра
остаётся сайт-агностичным. Для RU-сайтов главная AI-площадка — **Яндекс Нейро** (индекс Яндекса), поэтому
топ-10 в Яндексе + schema + свежесть решают.

| Компонент | Файл | Что делает |
|---|---|---|
| **Скорер цитируемости** | `lib/citability.mjs` | Детерминированно (без LLM) бьёт статью на секции по H2/H3 и оценивает 0-100 по 5 категориям: answer-first (прямой ответ первой фразой), self-containment (без ведущих местоимений, назван субъект), структура (абзац 90-170 слов + списки/таблицы), плотность фактов/цифр, definition-паттерн/вопросный заголовок. Возвращает `{score, sections, weakSections}`. Использовать как **гейт фактчека** (рядом со «слов≥1300 / уник≥82%»: ниже порога — 1 цикл переписывания слабых секций) и в daily-report. `citabilitySummary(md)` — строка для лога. |
| **Генератор JSON-LD** | `lib/schema.mjs` | `buildArticleGraph({title,description,url,datePublished,dateModified,image,keyword,md})` → один `@graph`: Article/BlogPosting + Person(автор c sameAs/knowsAbout) + Organization + BreadcrumbList + **FAQPage** (авто-извлечение Q/A из тела через `extractFaq`) + `speakable`. Вставлять **server-side** в Astro-layout: `<script type="application/ld+json" set:html={JSON.stringify(buildArticleGraph(...))} />`, НЕ JS-инъекцией. |
| **llms.txt / llms-full.txt** | `lib/llmstxt.mjs` | `buildLlmsTxt(pages, opts)` по спеке llmstxt.org: H1(бренд) + blockquote(описание) + секции Ключевые факты / Статьи / Контакты со ссылками и описаниями. Заменяет примитивный `updateLlmsTxt()`. Публикуется в `public/llms.txt` при деплое. |
| **robots.txt для AI-ботов** | `scripts/templates/robots.geo.txt` | Готовый шаблон: разрешает GPTBot/OAI-SearchBot/ChatGPT-User/ClaudeBot/PerplexityBot/Google-Extended/YandexAdditional и т.д., блокирует Bytespider. Скопировать в `public/robots.txt`, заменить `SITE`. Если боты заблокированы — весь GEO бесполезен, это фундамент. |
| **Апгрейд промпта генерации** | правка `lib/generate-post.mjs` | В systemPrompt добавить: TL;DR-бокс 40-60 слов сверху; answer-first (1-2 фразы прямого ответа под каждым H2); 60-70% H2 как вопросы (из Arsenkin PAA); «citation capsule» на секцию; сравнительная таблица с шапкой; жирные определения терминов; evidence-triple на каждую статистику (год в прозе + источник + дата доступа). |

**Как встроить в фактчек** (`lib/generate-post.mjs`): после генерации `const cit = scoreCitability(mdx)`; если `cit.score < 60` — один проход переписывания `cit.weakSections` (тот же паттерн, что цикл добивания объёма, ≤2 попытки), иначе публиковать. Средний `cit.score` новых статей — в daily-report.

## Автономный режим — реальный AI-сотрудник, а не workflow (`agent.mjs`)

Это то, что превращает «просто автоматизацию» в автономного SEO/GEO-специалиста: он САМ смотрит на
состояние сайта, решает что даст максимум к цели (рост трафика/заявок), делает это или предлагает человеку,
журналирует и учится. Дефолт (линейный `run.mjs`) остаётся; автономный режим — отдельная точка входа
`node scripts/seo-agent/agent.mjs` (ставится на cron параллельно/вместо публикационного прогона).

**Цикл (ReAct, не фикс-workflow):**
1. **Восприятие** (`perceive()` в agent.mjs): собирает состояние — позиции/спрос (`report-state.json`), AI SoV
   (`ai-sov.json`), Brand Authority (`brand-authority.json`), расход и остаток дневного бюджета, очередь
   предложений, идущие эксперименты. Сюда же подключаются живые `metrika.metrikaToday()` (трафик/заявки) и
   `webmaster.demandGaps()` при интеграции.
2. **Решение** (`decide()`): LLM (Sonnet) по состоянию + целям + каталогу инструментов + журналу выбирает
   ОДНО следующее действие (JSON `{thought, action, args, why}`) или `stop`. Видит результат — решает дальше.
3. **Действие** (`lib/agent-tools.mjs`, `invokeTool`): два класса риска —
   - **auto** (обратимо, в бюджете) — делает САМ: `generate_article`, `expand_thin`, `rewrite_ctr`,
     `refresh_stale`, `ai_probe`, `brand_scan`, `drift_check` (обёртки над существующими скриптами ядра).
   - **approve** (необратимо/наружу/дорого) — `deploy_widget`, `redesign_block`, `new_section`, `outreach`,
     `big_spend` — НЕ выполняет, а `proposeAction()` шлёт предложение в Telegram (`/approve <id>` / `/reject <id>`).
4. **Журнал + обучение** (`lib/agent-journal.mjs`): каждое решение → `journal.jsonl`; гипотезы → `experiments.json`
   (метрика до/после — сработало усиливаем, нет откатываем); предложения → `proposals.json`.

**Гейты автономии (безопасность):** дневной бюджет `autonomy.dailyBudgetUsd` (по исчерпании — стоп),
`maxCyclesPerRun`, класс риска auto/approve (рискованное всегда к человеку — `autoApprove:false` по умолчанию),
все публикации через существующие проверки (уникальность/citability/eeat/ai-slop), полный decision-log.
Человек управляет через бот: `/proposals` (что ждёт), `/approve <id>`, `/reject <id>` (добавлены в `bot.mjs`).

**Цели** — раздел `goals` в `site.profile.mjs` (что для сайта значит «результат»: KPI трафик/топ-10/заявки/AI SoV).
**Настройки** — раздел `autonomy` (бюджет, maxCycles, autoApprove).

Файлы: `agent.mjs` (цикл), `lib/agent-tools.mjs` (каталог+риск+обёртки), `lib/agent-journal.mjs`
(журнал/цели/эксперименты/предложения). Более лёгкий `lib/planner.mjs` (одноразовый приоритетный JSON-план)
остаётся как быстрый вариант без полного цикла.

**Честно про границы:** агент сам делает всю обратимую SEO/GEO-работу (контент, мета, перелинковка, схема,
переиндексация, замеры) — это 80% роста. Необратимое и наружу-видимое (новый виджет, редизайн, аутрич от имени
владельца) он ГОТОВИТ как конкретное предложение и ждёт одобрения — так работает реальный сотрудник, а не
бесконтрольный бот. Автономный слой пока в снапшоте скилла (синтаксис зелёный, каталог/журнал протестированы);
живой запуск на проде — вписать cron `agent.mjs` + подключить live-метрики в `perceive()`.

### Измеримость GEO (реализовано) — метрики и гейты качества

| Модуль | Файл | Что делает |
|---|---|---|
| **GEO-директивы генерации** | `lib/geo-prompt.mjs` | `GEO_DIRECTIVES` — блок в systemPrompt генерации (TL;DR, answer-first под H2, вопросные H2 из PAA, citation capsules, evidence-triple, таблицы, определения). `GEO_REWRITE_HINT` — для дожима слабых секций. Поднимает `citability.score` каждой статьи. Подмешать: `BASE_PROMPT + '\n\n' + GEO_DIRECTIVES`. |
| **AI Share of Voice** | `ai-citation-probe.mjs` | Гоняет `geo.probeQuestions` в LLM (aigate), проверяет упоминание бренда/домена в ответе и в списке рекомендаций → **AI SoV %** + тренд (`data/ai-sov.json`). Единственная метрика, показывающая, работает ли GEO. `sovReportLine()` — в daily-report. CLI: `node scripts/seo-agent/ai-citation-probe.mjs`. |
| **Brand Authority (RU)** | `brand-mentions.mjs` | Через xmlstock `<бренд> site:host` считает присутствие на YouTube/Wikipedia/VK/Дзен/Хабр/Пикабу/Telegram (RU-веса) → score 0-100 + слабые площадки. Упоминания коррелируют с AI-цитатами ~3x сильнее беклинков. Еженедельный cron → Telegram. |
| **E-E-A-T гейт** | `lib/eeat.mjs` | Детерминированный скоринг статьи 0-100 (автор+sameAs+креды, даты, внешние источники, объём, признаки опыта, YMYL-дисклеймер). Гейт генерации рядом с citability. |
| **Движок свежести 30д** | `lib/freshness.mjs` | `freshnessGaps(pages, {days:30})` — страницы старше N дней в очередь на рефреш (76% топ-AI-цитат ≤30 дн). `freshnessReportLine()` — % свежих в отчёт. Дополняет `health.mjs`. |
| **Composite GEO-score** | `lib/geo-score.mjs` | `compositeGeoScore({citability, brandAuthority, eeat, technical, schema, aiSov})` → единый балл 0-100 + рейтинг (веса из geo-audit). `geoScoreLine()` с дельтой ▲/▼ — в daily-report. |

**Как замкнуть цикл (интеграция в живой прогон — следующий шаг, не в снапшоте):** citability+eeat как гейты в
`generate-post.mjs` (ниже порога — переписать слабые секции через `GEO_REWRITE_HINT`); `GEO_DIRECTIVES` в
промпт генерации; `schema.buildArticleGraph()` в Astro-layout статьи, `buildWebSiteGraph()` на главную;
`buildLlmsTxt()` + `robots.geo.txt` на деплой; cron `ai-citation-probe` + `brand-mentions`; блок GEO-score +
AI SoV + свежесть в `daily-report.mjs`, и в `planner.mjs` snapshot добавить aiSov/freshness как сигналы.

**Дорожная карта (осталось):** `cluster-plan.mjs` (hub-and-spoke по SERP-overlap, анти-каннибализация,
авто-перелинковка) — частично закрыт существующими `demandGaps`/каннибализацией в `health.mjs`, вторая волна.
Вне скоупа автономного агента (это инструменты GEO-агентства): `geo-report`/`geo-report-pdf` (клиентские
отчёты), `geo-proposal` (КП), `geo-prospect` (CRM лидов), `geo-compare` (месячная дельта клиенту) — из них
взята только формула composite-score (реализована в `geo-score.mjs`) и идея дельта-трекинга (уже есть через
`report-state.json`).

## Массовая генерация (`scripts/seo-agent/generate-batch.mjs`)

`BATCH_COUNT=150 node scripts/seo-agent/generate-batch.mjs` — генерит N статей по семантике в очередь
`data/queue/` (Sonnet, целевой объём ~1500 + структурный фактчек, без проверки уникальности — она на
публикации). Резюмируемо, шлёт прогресс в Telegram. Запускать на VPS в фоне: `nohup node ... &`.
Дальше cron публикует по `MAX_NEW`/день.

## Ежедневный отчёт (`scripts/seo-agent/daily-report.mjs`)

Отдельный cron (например 09:00 UTC = 12:00 МСК, застаггерован от прогона генерации), не зависит от
бота. Блоки: **Трафик** (визиты/просмотры сегодня, `metrikaToday()`), **Источники** (прямой/поиск/
ссылки/мессенджеры — `trafficSourcesToday()`, мессенджеры вычисляются вручную по домену реферера:
t.me/wa.me/vk.me/viber.com/max.ru и т.п., это не нативная категория Метрики), **Страницы**
(проиндексировано по Вебмастеру `/summary` + дельта от прошлого отчёта), **Позиции** (топ10/50/100 +
тренд ▲/▼/🆕 против `data/report-state.json`), **Рекомендации** (демпинг высокого DEMAND без кликов,
см. ниже), **Расходы** в $ по сервисам за день (`lib/cost-ledger.mjs`). Первый запуск на новом сайте
всегда покажет 🆕 везде — `report-state.json` появляется после первого прогона.

## Скрипты

| Скрипт | Назначение |
|---|---|
| `seo-agent/run.mjs` | Главный прогон (очередь или живая генерация). По cron. |
| `seo-agent/generate-batch.mjs` | Массовая генерация N статей в очередь. |
| `seo-agent/daily-report.mjs` | Ежедневный сводный отчёт (трафик/источники/страницы/позиции/расходы). Отдельный cron. |
| `seo-agent/expand-existing.mjs` | Расширить существующие тонкие страницы. |
| `seo-agent/cleanup-mdx.mjs` | Починить MDX: убрать import/JSX, ремонт factbox/якорей, экранировать `<`/`>`. |
| `seo-agent/competitor-analysis.mjs` | Анализ выдачи по кластерам (где легко в топ). |
| `seo-agent/positions-report.mjs` | Еженедельный отчёт позиций (топ-30, динамика) в Telegram. |
| `seo-agent/patch-uniqueness.mjs` | Идемпотентный патч перевода проекта на `lib/uniqueness.mjs`. |
| `seo-agent/test-apis.mjs` | Проверка связности всех интеграций. |
| `seo-agent/config.mjs` | Конфиг из `.env`, `readiness()`. |
| `seo-agent/lib/content.mjs` | Коллекции/пул ссылок/слаги/запись MDX — читает `site.profile.mjs`. |
| `seo-agent/lib/generate-post.mjs` | Генерация + детерминированный фактчек статьи (порог 1300 слов). |
| `seo-agent/lib/xmlstock.mjs`, `webmaster.mjs`, `metrika.mjs` | SERP, Вебмастер (+`queryAnalytics()`/DEMAND), Метрика (+`metrikaToday()`/`trafficSourcesToday()`). |
| `seo-agent/lib/arsenkin.mjs` | LSI-подсветки, Wordstat, PAA-вопросы, каннибализация, ТЗ на копирайтинг. |
| `seo-agent/lib/ctr-optimize.mjs` | Переписать meta title/description у страниц с показами без кликов; `demandGaps()` — высокий рыночный спрос без кликов. |
| `seo-agent/lib/uniqueness.mjs` | Единый интерфейс: content-watch (основной) → text.ru (резерв). |
| `seo-agent/lib/contentwatch.mjs`, `textru.mjs` | Провайдеры уникальности. |
| `seo-agent/lib/cost-ledger.mjs` | `logCostUsd()`/`logCall()` — учёт расходов по сервисам, JSON-файл на день. |
| `seo-agent/lib/health.mjs` | Индексация: битые ссылки, каннибализация, авто-рефреш застрявших статей. |
| `seo-agent/lib/conversion.mjs` | Усилить CTA на страницах с трафиком без заявок. |
| `seo-agent/lib/indexnow.mjs` | IndexNow-пинг + постановка в очередь переобхода Вебмастера. |
| `seo-agent/lib/citability.mjs` | **GEO**: детерминированный скорер цитируемости 0-100 (гейт фактчека + отчёт). |
| `seo-agent/lib/schema.mjs` | **GEO**: генератор JSON-LD @graph (Article/FAQPage/Person/Org/Breadcrumb/speakable). |
| `seo-agent/lib/llmstxt.mjs` | **GEO**: llms.txt/llms-full.txt по спеке llmstxt.org. |
| `seo-agent/lib/planner.mjs` | **Агент**: LLM-планировщик приоритетов действий (ветка MODE=agent). |
| `templates/robots.geo.txt` | **GEO**: robots.txt, разрешающий AI-ботов (в `public/robots.txt`). |
| `seo-agent/lib/geo-prompt.mjs` | **GEO**: директивы генерации под цитирование (в systemPrompt). |
| `seo-agent/lib/eeat.mjs` | **GEO**: E-E-A-T скоринг статьи 0-100 (гейт генерации). |
| `seo-agent/lib/freshness.mjs` | **GEO**: движок свежести 30 дн (кандидаты на рефреш). |
| `seo-agent/lib/geo-score.mjs` | **GEO**: composite GEO-score для daily-report. |
| `seo-agent/ai-citation-probe.mjs` | **GEO**: AI Share of Voice (цитируют ли нас нейросети). Cron/CLI. |
| `seo-agent/brand-mentions.mjs` | **GEO**: Brand Authority Score по RU-площадкам. Cron/CLI. |
| `seo-agent/lib/serp-intent.mjs` | **SEO**: классификация топ-10 — гейт «выиграет ли статья» перед генерацией. |
| `seo-agent/lib/drift.mjs` | **SEO**: снапшот+диф SEO-элементов dist/ (ловит потерю schema/canonical/страницы). |
| `seo-agent/lib/cluster-plan.mjs` | **SEO**: SERP-overlap кластеризация, hub-and-spoke, анти-каннибализация. |
| `seo-agent/lib/content-brief.mjs` | **SEO**: конкурентный бриф (information gain) в промпт генерации. |
| `seo-agent/lib/ai-slop.mjs` | **SEO**: измеряемый детектор ИИ-текста (burstiness/клише/разнообразие). |
| `seo-agent/client.mjs` | **Агентство**: аудит клиентского сайта → отчёт+КП+PDF. CLI. |
| `seo-agent/lib/client-audit.mjs` | **Агентство**: внешний SEO+GEO аудит чужого сайта (без токенов). |
| `seo-agent/lib/client-report.mjs` | **Агентство**: печатный HTML-отчёт клиенту (→PDF). |
| `seo-agent/lib/proposal.mjs` | **Агентство**: КП с тарифами из аудита. |
| `seo-agent/lib/compare.mjs` | **Агентство**: помесячная динамика (удержание клиента). |
| `seo-agent/prospect.mjs` | **Агентство**: CRM воронки потенциальных клиентов. CLI. |
| `bot/bot.mjs` | Telegram-бот: диалог по проекту (через aigate) + резервный лид-эндпоинт. **Проверяет chat_id** — отвечает только владельцу (см. Безопасность). |
| `bot/max.mjs` | Дублирующее уведомление о заявках в MAX (botapi.max.ru), опционально. |
| `images/pollinations.mjs` | Основной провайдер картинок — Pollinations.ai, бесплатно, без ключа. |
| `images/images.mjs` | Единый интерфейс: Pollinations → kie.ai (молчаливый резерв при отказе). |
| `images/kie-nb2.mjs`, `generate-set.mjs` | Резервный провайдер kie.ai Nano Banana 2 + сжатие sharp. |
| `deploy-ftp.py` | Деплой `dist/` на FTP-хостинг (креды из `.env`). |

## Интеграции и эндпоинты (проверены рабочими)

- **xmlstock** (SERP/семантика): `https://xmlstock.com/yandex/xml/?user=&key=&query=&lr=225`.
- **aigate** (OpenAI-совм.): `https://api.aigate.shop/v1/chat/completions`, генерация —
  `anthropic/claude-sonnet-4.6`, диалог бота — `deepseek/deepseek-v4-pro`. Слать браузерный User-Agent.
  Таймаут 120с на fetch — зависший внешний запрос иначе вешает весь прогон агента навсегда. **Каждый
  ответ содержит `usage.cost_usd`** — реальная цена вызова, используется `lib/cost-ledger.mjs` вместо
  оценки по токенам. Есть `GET /v1/balance` для остатка на счёте.
- **Pollinations.ai** (картинки, основной, бесплатно, без ключа): `https://image.pollinations.ai/prompt/
  {encoded}?width=&height=&model=flux&nologo=true&seed=`.
- **kie.ai** (картинки NB2, резерв): `POST /api/v1/jobs/createTask` {model:"nano-banana-2",
  input:{prompt, aspect_ratio, resolution, output_format:"png"}} → poll `/api/v1/jobs/recordInfo?taskId=`.
- **content-watch.ru** (уникальность, основной провайдер, дешевле text.ru): `POST
  content-watch.ru/public/api/` `{key, action:CHECK_TEXT, text}` → `{error, percent}`.
- **text.ru** (резерв): `https://api.text.ru/post` (add→uid, затем poll по uid). Платный, следить за
  балансом — при исчерпании тихо роняет фактчек с ошибкой `error 142`.
- **Arsenkin Tools** (LSI/Wordstat/PAA, опц.): `https://arsenkin.ru/api/tools` (set→check→get),
  лимит 30 запросов/мин. Нет балансового API — считать по числу вызовов, не $.
- **Я.Вебмастер v4**: `https://api.webmaster.yandex.net/v4` (OAuth-токен). user/{id}/hosts/{host}/
  search-queries/popular, /recrawl/queue, /user-added-sitemaps/, /summary (проиндексировано страниц),
  **`/query-analytics/list`** (POST, `{offset,limit,device_type_indicator:'ALL',text_indicator:'QUERY',
  region_ids:[],filters:{},order_by:'TOTAL_SHOWS'}`) → per-query `IMPRESSIONS`/`CLICKS`/**`DEMAND`**
  (рыночный спрос независимо от текущей видимости сайта — не то же самое, что показы). host_id вида
  `https:domain.ru:443`.
- **Я.Метрика**: `https://api-metrika.yandex.net/stat/v1/data` (тот же OAuth-токен, что Вебмастер).
  `date1=today&date2=today` для строго сегодняшней статистики (не за период).
- **Telegram**: бот-токен от @BotFather, chat_id через getUpdates.
- **MAX** (botapi.max.ru, опц.): заголовок `Authorization: TOKEN` (без Bearer/OAuth-префикса).
  `GET /chats` для поиска chat_id, `POST /messages?chat_id=`. У свежего бота 0 чатов — юзер должен
  один раз написать боту сам, иначе слать некуда.

## Безопасность (обязательно на новом сайте)

- **`bot.mjs` проверяет `TELEGRAM_CHAT_ID` на входе** — без этого любой нашедший бота в Telegram
  бесплатно гоняет платный LLM и видит историю диалога. Уже встроено в текущий снапшот скилла — при
  ручных правках бота не убирай эту проверку.
- **`chmod 600 .env`** на сервере — по умолчанию файлы часто оказываются 644 (читаемы любым локальным
  пользователем VPS).
- **FTP/API-креды никогда не хардкодить в коде** — только через `.env`/`process.env`, `.env` в
  `.gitignore`. Если проект живёт в git — не коммитить секреты даже временно (историю потом не
  вычистить без явного согласия владельца).
- Все fetch-клиенты ядра уже с `AbortSignal.timeout()` — не убирай при правках, иначе зависший
  внешний сервис вешает весь cron-прогон навсегда без восстановления.

## SEO-усиление (вторая волна, реализовано)

Добраны приёмы из SEO-скиллов (seo-sxo/seo-drift/seo-cluster/seo-content-brief/blog-analyze), адаптированные
под РФ-стек (Яндекс/xmlstock, без Google/DataForSEO). Все детерминированные или на уже подключённых API.

| Модуль | Файл | Что делает |
|---|---|---|
| **SERP-интент гейт** | `lib/serp-intent.mjs` | `classifySerp(keyword, serp)` классифицирует топ-10 (article/aggregator/marketplace/catalog/video) → не тратить генерацию на ключи, где топ занят агрегаторами (статья не выиграет). `filterWinnable()` — фильтр кандидатов ПЕРЕД генерацией. Повышает hit-rate в топ. |
| **Drift-монитор** | `lib/drift.mjs` | `runDrift(distDir)` — снапшот title/canonical/robots/H1/schema/OG из `dist/` + диф против прошлого. Ловит грабли «Astro молча уронил страницу/schema/canonical/noindex». Без внешних API. В конце деплоя → `driftReportLine()` в daily-report. |
| **Кластеризация SERP** | `lib/cluster-plan.mjs` | `clusterBySerp(items)` — общий топ-10 = один кластер; hub-and-spoke, матрица перелинковки hub↔spoke, детект каннибализации (ключи с большим overlap → одна страница). Топикал-авторитет. |
| **Content-brief** | `lib/content-brief.mjs` | `buildBrief(keyword, topSerp, {paa,lsi})` → аутлайн с посекционными объёмами + «information gain» (что конкуренты упустили) → в systemPrompt generate-post. Дифференциация, меньше «клонов». |
| **AI-slop гейт** | `lib/ai-slop.mjs` | `scoreAiSlop(mdx)` — измеряемый детектор ИИ-текста: burstiness (вариативность длин предложений), банлист клише, лексическое разнообразие → 0-100. Гейт рядом с citability/eeat: ниже порога — прогнать humanizer ещё раз. Даёт МЕТРИКУ шагу очеловечивания. |

**Мелкие догрузки (по матрице, не отдельные модули):** alt-text/webp-чек в image-пайплайне (описательность alt ≤125 симв); `schema.mjs` — LocalBusiness/MedicalClinic для siteType=org/catalog с адресом (vradok/клиники). ⚠️ **FAQPage**: с авг.2023 НЕ даёт Google rich-result для коммерческих сайтов (только gov/health), но остаётся сильным сигналом ДЛЯ AI-цитирования — в `schema.mjs` используется именно ради GEO, не ради Google-сниппета (осознанно).

## SEO-усиление (третья волна — гейты качества, из claude-seo)

Добрано 4 детерминированных модуля (без платных API), вплетены в `daily-report.mjs` блоком **«🔎 Качество и техника»** (мягко: аудит/сигнал в отчёт, НЕ жёсткие блокеры — чтобы не ронять автопилот):

| Модуль | Файл | Что делает |
|---|---|---|
| **Гейт дорвейности/тонкости** | `lib/quality-gates.mjs` | `auditQualityFromDist(dist)` — по собранному dist: тонкие страницы (мин. слов по типу), near-duplicate (Jaccard по 4-шинглам, ловит city×niche-клоны), дорвей-гейт (⚠️30+ / 🛑50+ страниц одной «модели»=ниши). Защищает программатик-сетку (vradok/novostroyki/tovaryplus) от санкций за тонкий/дублирующийся контент. |
| **Тех-аудит on-page** | `lib/onpage-audit.mjs` | `auditDist(dist)` — title/desc-длины, кол-во H1, canonical, noindex на боевой, alt у картинок, наличие JSON-LD, битые внутр. ссылки. Критично/предупреждения в отчёт. |
| **Валидатор schema** | `lib/schema-validate.mjs` | `validateDist(dist)` / `validateGraph(obj)` — обязательные поля по типу (Article/FAQPage/Person/Breadcrumb…), невалидный JSON-LD, deprecated-типы (HowTo/ClaimReview). |
| **Core Web Vitals** | `lib/pagespeed.mjs` | `pageSpeed(url)` — LCP/INP/CLS + Perf-score через Google PageSpeed Insights v5 (**бесплатный API, покрывает РФ-домены**). `PAGESPEED_KEY` в `.env` опционален; без ключа быстро упирается в квоту shared-IP → строка «нет данных». |

Проверено на реальном dist novostroyki (196 стр → тонких 125, дорвей-риск blog(76)/novostroyki(60), schema 191 блок 0 крит, тех-аудит 0 крит).

**Тонкие → очередь на обогащение (не шум, а задачи):** `enrichmentQueue(audit, fileForUrl)` (в `lib/quality-gates.mjs`) делит тонкие на **статьи** (есть исходный MDX → `fileForUrl` находит файл) и **карточки каталога** (нет MDX, глубина URL ≥2 — напр. `/novostroyki/жк/` или `/город/ниша/слаг/`; статичные/индексные страницы ≤1 отсеиваются). `daily-report.mjs` каждую ночь пишет `data/enrichment-queue.json` `{articles:[{url,file}], cards:[{url}], nearDup, doorway}` и показывает счётчики в блоке «Качество и техника». `expand-existing.mjs` теперь **читает эту очередь** и добивает до 1500 слов только тонкие статьи, по `EXPAND_LIMIT` (деф. 6) за прогон — работает список задач, а не всё подряд каждый раз. Карточки (`cards`) — вход для ЖК-обогащения (bespoke-пайплайн сайта). Тест novostroyki: 125 тонких → 10 статей (expand) + 108 карточек ЖК (обогащение). ОСТАЛОСЬ: поставить `expand-existing` на cron и подключить потребителя `cards` к ЖК-enrichment на novostroyki. Взято из AgriciDaniel/claude-seo (references/quality-gates.md, seo-technical, seo-schema-validate, pagespeed_check.py), адаптировано под РФ-стек. Не бралось (Google-центрично / есть РФ-аналог): GSC/GA4/Indexing (→ Вебмастер/Метрика/IndexNow), DataForSEO/Ahrefs/Moz (→ xmlstock/Arsenkin), Local/Maps/GBP (→ Яндекс.Бизнес, вне claude-seo), hreflang (уже есть), e-commerce/NLP-entity.

**Вне скоупа автономного РФ-агента (подтверждено матрицей):** seo-maps/seo-local (нет локального бизнеса — максимум LocalBusiness-схема), seo-google (Вебмастер+Метрика+IndexNow = RU-эквивалент GSC/GA4/CrUX), seo-backlinks/seo-dataforseo (xmlstock+arsenkin+brand-mentions замещают), seo-ecommerce (сайты контентные), seo-firecrawl (свой исходник + xmlstock), seo-hreflang (моноязычные; кроме ilyaegorov RU/EN — точечно).

## Два режима работы + онбординг-бриф

Агент работает в двух режимах (задаётся `mode` + `skills` в `site.profile.mjs`, которые проставляет
онбординг-бриф при первом запуске):

- **`mode: 'own'` — свой сайт** (как сейчас): автопилот контента + GEO + опц. автономный режим. Данные —
  из своих Метрики/Вебмастера.
- **`mode: 'client'` — обслуживание клиентских сайтов** (агентство): внешний аудит чужого сайта без его
  токенов, клиентские отчёты, КП с тарифами, помесячная динамика, CRM воронки клиентов.
- **`mode: 'both'`** — и то, и другое.

**Онбординг-бриф → навыки.** Бриф (чек-лист при первом запуске) маршрутизирует ответы в `profile.skills`:
`contentAutopilot` (генерация статей), `geo` (оптимизация под нейросети), `autonomy` (агент сам решает и
делает), `agency` (клиентский режим). Код ядра читает эти тумблеры — включаются только выбранные навыки.

## Агентский режим — обслуживание клиентских сайтов

Нужен, когда агентом обслуживают ЧУЖИЕ сайты (продажа SEO/GEO-услуги). Настройка — раздел `agency` в
профиле (бренд, контакты, пакеты-тарифы). Один вход: `node scripts/seo-agent/client.mjs <cmd> <url>`.

| Инструмент | Файл | Что делает |
|---|---|---|
| **Внешний аудит** | `lib/client-audit.mjs` | `auditClientSite(url)` — краулит публичные страницы клиента БЕЗ его токенов, детерминированно считает SEO+GEO (цитируемость, Schema, доступ AI-ботов, llms.txt, on-page, тонкий контент) → score + проблемы по важности + быстрые победы. |
| **Клиентский отчёт** | `lib/client-report.mjs` | `renderClientReport(audit)` → печатный HTML-отчёт (score-карточки, проблемы, страницы, брендинг агентства). **PDF** = печать HTML в headless-chrome (`chrome --headless --print-to-pdf`). |
| **КП (коммерческое предложение)** | `lib/proposal.mjs` | `renderProposal(audit)` → HTML КП: проблемы из аудита → что сделаем → рекомендованный пакет (по баллу сайта) → цена → результат. Тарифы из `agency.packages`. |
| **Динамика (удержание)** | `lib/compare.mjs` | Хранит историю аудитов клиента, `compareLatest(url)` → помесячная дельта score + что починили/что появилось. Для ежемесячного отчёта клиенту. |
| **CRM лидов** | `prospect.mjs` | Воронка ПОТЕНЦИАЛЬНЫХ КЛИЕНТОВ (не заявки с сайта!): сайт-кандидат → статус (new/contacted/audit_sent/proposal_sent/negotiating/won/lost) → заметки. CLI: `prospect.mjs add\|list\|set\|note`. `fmtFunnel()` в бот. |

`client.mjs`: `audit <url> [Имя]` (аудит + отчёт.html + КП.html + PDF-подсказка), `report`/`kp`/`compare`.
Результаты — в `data/agency/clients/<url>/`.

## Юр-комплаенс РФ (152-ФЗ / Роскомнадзор) — ОБЯЗАТЕЛЬНО на каждом сайте

Сайт, собирающий заявки (имя/телефон/почту) и использующий Яндекс Метрику, по закону обязан иметь
4 вещи. Реквизиты оператора берутся из раздела `legal` в `site.profile.mjs` (см. пример). Шаблоны — в
`scripts/templates/`.

| Требование | Как выполнить | Шаблон |
|---|---|---|
| **Политика ТЕКСТОМ на HTML-странице** (НЕ скачиваемый .doc/.pdf — это нарушение) | Скопировать в `src/pages/politika-konfidencialnosti/index.astro`, поправить путь импорта layout | `templates/politika-konfidencialnosti.astro` |
| **Cookie-баннер + гейтинг Метрики** (аналитика грузится ТОЛЬКО после согласия) | Обернуть счётчик Метрики в `window.__ymLoad` и добавить баннер в конец `<body>` BaseLayout | `templates/cookie-consent.html` |
| **Чекбокс согласия на формах** (обязательный, форма не шлётся без него) | Вставить в LeadForm перед кнопкой submit | `templates/consent-checkbox.html` |
| **Реквизиты оператора в подвале** | Строка в Footer: `{legal.entityName}, ОГРНИП {legal.ogrnip}, ИНН {legal.inn}, {legal.address}` + ссылка на политику | из `PROFILE.legal` |

⚠️ Ключевое: Метрика НЕ должна грузиться до клика «Принять» — иначе сбор обезличенных данных без согласия.
Паттерн `__ymLoad` в шаблоне это решает (грузит только если `localStorage['cookie-consent']==='accepted'`).
Оператором указывается владелец сайта (ИП/ООО) — данные в `legal`. Ссылку на политику дать в подвале и в
баннере. `noindex` на самой странице политики (в шаблоне уже стоит).

## Установка на НОВЫЙ сайт

1. Скопировать `scripts/` + `site.profile.example.mjs` в корень Astro-проекта, переименовать в
   `site.profile.mjs` и заполнить под сайт (см. раздел выше).
2. `cp .env.example .env`, заполнить ключи (xmlstock/aigate — обычно общие на все проекты; content-watch/
   Arsenkin/kie.ai/MAX — тоже часто общие; Я.Вебмастер+Метрика OAuth, Telegram, FTP-креды — СВОИ у
   каждого сайта).
3. Если `isTarget`-коллекция на `.mdx` — проверить/поставить `@astrojs/mdx` в `astro.config.mjs`
   (см. предупреждение выше — самая незаметная причина "агент публикует, а на сайте 404").
4. `node scripts/seo-agent/test-apis.mjs` — проверить интеграции.
5. Подтвердить сайт в Я.Вебмастере (через Метрику — 1 клик, либо meta-тег `yandex-verification` в
   `<head>`), добавить sitemap, создать счётчик Метрики.
6. Лиды: положить PHP-форвардер `scripts/lead.php` на хостинг (читает форму, шлёт в Telegram
   +опционально MAX — **вписать реальный TOKEN/CHAT_ID на месте, шаблон в git не хранит секреты**),
   `PUBLIC_LEAD_ENDPOINT=/api/lead.php` (same-origin, без зависимости от VPS).
7. **Юр-комплаенс РФ (152-ФЗ)**: заполнить `legal` в `site.profile.mjs`; развернуть 4 шаблона из
   `scripts/templates/` (политика-страница, cookie-баннер+гейтинг Метрики, чекбокс согласия, реквизиты в
   подвал) — см. раздел «Юр-комплаенс» выше. Без этого сайт с формой+Метрикой нарушает закон.
8. **Финальная проверка перед cron**: `DRY_RUN=false node scripts/seo-agent/run.mjs` вручную один
   раз, дождаться реального `Опубликовано: N>0` в логе И проверить, что опубликованный URL
   действительно отдаёт 200 (не только "скрипт не упал" — Astro может молча не собрать страницу).
8. Ежедневный отчёт: отдельная cron-строка на `daily-report.mjs` (см. ниже), со сдвигом от прогона
   генерации, чтобы не толкаться за ресурсы/API-лимиты.

## Развёртывание на VPS (pm2 + cron)

```
# на VPS, /opt/<project>
npm install
pm2 start ecosystem.config.cjs --only <bot-name>   # бот 24/7
pm2 save && pm2 startup                              # автозапуск при reboot
# cron агента (UTC! ставь со сдвигом от других проектов на том же VPS, чтобы не толкались за ресурсы):
crontab -e →  0 0 * * * cd /opt/<project> && /usr/bin/node scripts/seo-agent/run.mjs >> logs/agent.cron.log 2>&1
# ежедневный отчёт (12:00 МСК = 09:00 UTC, сдвинуть по минутам от других проектов на том же VPS):
crontab -e →  0 9 * * * cd /opt/<project> && /usr/bin/node scripts/seo-agent/daily-report.mjs >> logs/report.cron.log 2>&1
# массовый батч (один раз, в фоне):
cd /opt/<project> && nohup node scripts/seo-agent/generate-batch.mjs > logs/batch.log 2>&1 &
```
Только ОДИН поллер Telegram на токен (останови локального бота перед запуском на VPS).

## Правила и грабли (важно!)

- **Объём статьи: публикуем от 1300 слов, добиваем циклом до 1500 (не более 2 попыток).** Жёсткий
  порог ровно 1500 гонял пограничные статьи (1300-1499 слов) по кругу регенерации вместо публикации —
  чистый перерасход aigate.shop без пользы для читателя. Фактчек режет только то, что < 1300.
- **≥3 внутренних ссылки** — жёстко, и это ЖИВОЙ пул (`internalLinkPool()` из `site.profile.mjs`
  коллекций+linkCatalogs), не хардкод. Пустой пул на новом каталожном сайте = вечный отказ всех
  статей — см. `linkCatalogs` выше.
- **MDX ломается** на: голых `<`/`>` (сравнения), `import`/`export`, JSX-компонентах `<Component/>`.
  → `sanitizeMdx()` в `generate-post.mjs` это вычищает; в промптах запрещено import/JSX, сравнения
  писать словами; единственный разрешённый HTML — `<aside class="factbox">…</aside>`.
- **`.mdx`-коллекция без `@astrojs/mdx`** — молча пустая при сборке (см. выше). Самая незаметная
  ловушка: агент репортует "опубликовано", а на сайте 404.
- **Хардкод путей в правках ядра — красный флаг.** Любой `/blog/` или `/uslugi/`, вписанный напрямую
  в код (а не взятый из `site.profile.mjs`), работает только на сайте, где это совпало случайно, и
  тихо ломается на следующем сайте с другой структурой. Все такие места уже исправлены в этом
  снапшоте (`targetUrlBase()`, регэксп фактчека из `PROFILE.content.collections`+`linkCatalogs`) —
  не возвращай хардкод при доработках.
- **Reg.ru за прокси**: для http→https в `.htaccess` использовать `RewriteCond %{SERVER_PORT} !^443$`,
  НЕ `%{HTTPS} off` (иначе цикл редиректа кладёт сайт).
- **Деплой dist/ через FTP** (pathlib rglob включает dotfiles — `.htaccess` заливается).
- **Astro теряет scoped-стили** при `inlineStylesheets:'auto'` → ставить `inlineStylesheets:'never'`.
- **Фейковое фото реального эксперта НЕ генерировать** (E-E-A-T/этика) — только реальное; NB2 для
  концептуальных визуалов/обложек/OG.
- **Цифры лимитов/ставок 2026**, в которых не уверен, помечать «уточняется по НК РФ» (или отраслевому
  аналогу) — не выдумывать.
- **VPS бывает нестабилен** — сайт на отдельном хостинге это переживает; бот/cron возвращаются по
  pm2 startup.
- **Смоук-тест "зелёный" ≠ сайт реально публикует.** Финальная проверка — живой прогон с
  `DRY_RUN=false` и подтверждение 200 на опубликованном URL, а не только "скрипт завершился без ошибок".

## Частые команды

```
node scripts/seo-agent/test-apis.mjs              # проверка интеграций
node scripts/seo-agent/competitor-analysis.mjs    # где легко в топ
DRY_RUN=true MAX_NEW_PAGES=1 node scripts/seo-agent/run.mjs   # тест без публикации
node scripts/seo-agent/expand-existing.mjs        # добить тексты до 1500+
node scripts/seo-agent/cleanup-mdx.mjs            # починить MDX
node scripts/seo-agent/positions-report.mjs       # отчёт позиций (топ-30, динамика)
node scripts/seo-agent/daily-report.mjs           # ежедневный сводный отчёт (трафик/источники/позиции/расходы)
BATCH_COUNT=150 node scripts/seo-agent/generate-batch.mjs    # массовая генерация
npm run build && python scripts/deploy-ftp.py     # ручной деплой
```

⚠️ **Никогда не проверяй синтаксис через `node -e "import('./run.mjs')"` или аналог** — любой файл
с `main().catch(...)` на верхнем уровне модуля выполняет прогон целиком в момент импорта, даже если
цель была просто «убедиться, что не упадёт». Это реально запускало боевую публикацию (с тратой
платных API) дважды при разработке этого агента. Единственная безопасная проверка синтаксиса —
`node --check file.mjs`.
