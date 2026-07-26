# On-page апгрейды Astro-сайта (Волна А)

Готовые интеграции, повышающие SEO/GEO и UX. Ставятся в любой Astro-проект ядра.

## 1. Оглавление + якоря заголовков (remark-toc + rehype)

Даёт `id` на каждом h2–h4 (глубокие ссылки для людей и нейросетей — важно для цитируемости)
и авто-оглавление в статьях с заголовком «Содержание»/«Оглавление».

```bash
npm i -D remark-toc rehype-slug rehype-autolink-headings
```

В `astro.config.mjs` (верхний уровень `defineConfig`, mdx() наследует через extendMarkdownConfig):

```js
import remarkToc from 'remark-toc';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';

markdown: {
  remarkPlugins: [[remarkToc, { heading: '(содержание|оглавление|contents?)', maxDepth: 3 }]],
  rehypePlugins: [
    rehypeSlug,
    [rehypeAutolinkHeadings, { behavior: 'wrap', properties: { className: ['heading-anchor'] } }],
  ],
},
```

Проверка после build: `grep -c heading-anchor dist/<раздел>/<статья>/index.html` > 0.

## 2. Поиск по сайту (Pagefind) — статический, без бэкенда

Индексирует собранный `dist/`, работает на статике (reg.ru/FTP). Идеален для каталогов.

```bash
npm i -D pagefind
```

`package.json` → build становится: `"build": "astro build && pagefind --site dist"`
(deploy-ftp.py заливает весь dist, /pagefind/ уезжает на прод сам).

Страница поиска: `src/pages/poisk/index.astro` (см. `templates/poisk.astro`), подключает
`/pagefind/pagefind-ui.{css,js}` + `new PagefindUI({...})` с русскими translations.

Чистый индекс: на глобальные `<header>`/`<footer>` повесить `data-pagefind-ignore`
(чтобы навигация не попадала в результаты). Ссылку «Поиск» — в шапку.

Проверка: `dist/pagefind/pagefind-entry.json` → `page_count` > 0; `/poisk/` и
`/pagefind/pagefind-ui.js` отдают 200 на проде.

## 3. Графики в отчётах/КП (ECharts SSR)

`lib/charts.mjs` — Apache ECharts в режиме SSR (`renderToSVGString`) → инлайн-SVG,
безопасно вкладывается в HTML и рендерится в PDF (gotenberg). scoreGauge / categoryBars / donut.
Fallback zero-dep SVG, если echarts не установлен. `npm i echarts` там, где рендерятся отчёты.

## 4. Crawl-аналитика логов (goaccess + lib/logaudit.mjs)

reg.ru отдаёт сырые COMBINED access-логи по FTP (`/logs/<domain>.access.log[.N.gz]`).
`lib/logaudit.mjs`: fetchLogs (FTP) → parseAccessLog (краулинг-бюджет: поисковики/ИИ-краулеры/
скрейперы, битые URL глазами ботов) + goaccessHtml (дашборд). Ключевой GEO-сигнал —
реально ли нейросети (GPTBot/ClaudeBot/PerplexityBot) ходят по сайту.
`npm i basic-ftp` + `apt install goaccess` на хосте агента.

## 5. Своя аналитика (Umami, cookieless) — first-party без DNS

Self-host на VPS (docker: umami + postgres, порт 3011). Один дашборд по всем сайтам,
приватная cookieless-аналитика (не требует cookie-согласия по 152-ФЗ — данные полные
даже при отказе от cookie). Яндекс.Метрику оставляем за согласием — они дополняют друг друга.

**HTTPS-трекинг без правки DNS — first-party PHP-прокси** (лучше субдомена: обходит адблок/ITP):
1. В Umami создать сайт: `POST /api/websites {name,domain}` → получить `websiteId`.
2. Залить `templates/umami-proxy.php` → `<site>/api/u.php` (правит $UPSTREAM на свой VPS:порт).
3. Rewrite в **api/.htaccess** (НЕ в корневой — на reg.ru вложенный перебивает корневой):
   `RewriteEngine On` + `RewriteRule ^send$ u.php?p=send [L,QSA]`
4. Сниппет в BaseLayout (грузится безусловно в PROD, cookieless):
   `{import.meta.env.PROD && ANALYTICS.umami && <script defer is:inline src="/api/u.php?p=script" data-website-id={ANALYTICS.umami}></script>}`
   + добавить `umami: '<websiteId>'` в consts ANALYTICS.
5. Проверка: `/api/u.php?p=script`→200 JS; POST `/api/send`→вернёт cache-JWT; в дашборде pageviews>0.

Прокси прокидывает User-Agent + X-Forwarded-For → корректная гео/уникальность визитёров.

## 6. A/B-тесты форм/CTA (GrowthBook, self-host)

Стек на VPS (docker: growthbook + mongo, фронт :3102, API :3100, ~2ГБ RAM). Дашборд управляет
экспериментами, SDK на сайте раздаёт варианты детерминированно (одному посетителю — стабильный вариант).

**Настройка (через API, secret_admin-ключ):**
1. Организация: `POST /organization {company}`; SDK-connection: `POST /sdk-connections {name,languages:["javascript"],environment,projects:[prj]}` → `clientKey`.
2. Фича-эксперимент через **REST v1** (сам рулит ревизиями, внутренний draft-API капризный):
   `POST /api/v1/features/<id>` с rule `{type:"experiment",id,enabled,trackingKey,hashAttribute:"id",hashVersion:2,coverage:1,namespace:{enabled:false,name:"",range:[0,1]},value:[{value,weight}]}`.
   Проверка: `GET /api/features/<clientKey>` → в payload появятся `rules:[{variations,weights,key}]`.

**Связка с сайтом (first-party, HTTPS без DNS):**
3. Прокси `templates/growthbook-proxy.php` → `<site>/api/gb.php` (правит clientKey+VPS).
4. Инлайн-эвалюатор `templates/growthbook-eval.js` в BaseLayout (`<script is:inline set:html>`):
   стабильный visitor-id (localStorage) → fnv1a32-хеш GrowthBook v2 → выбор варианта → подмена
   текста CTA (`button.lead__submit`) → трек экспозиции `exp-<key>` и конверсии `lead-submit` в Umami.
   Хеш v2: `(fnv(String(fnv(id+trackingKey)))%10000)/10000`, вариант по кумулятивным weights×coverage.
5. Результаты: события экспозиции+конверсии с полем variation летят в Umami → сравнение конверсии
   по вариантам. Полный стат-движок GrowthBook = подключить его к БД Umami (postgres) как data source.
