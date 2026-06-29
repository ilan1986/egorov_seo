---
name: egorov_seo
description: >-
  Автономный SEO/GEO контент-агент для русскоязычных сайтов (по образцу проекта Налог-Эксперт /
  example.ru). Разворачивает и эксплуатирует систему, которая САМА собирает семантику,
  генерирует экспертные статьи (≥1500 слов) через aigate/Sonnet, очеловечивает, проверяет
  уникальность через text.ru, публикует на сайт (Astro→FTP), шлёт на переобход в Яндекс.Вебмастер
  + IndexNow и отчитывается в Telegram. Поддерживает массовую батч-генерацию в очередь и публикацию
  по N статей в день по cron. Используй, когда нужно: поставить сайт на SEO-автопилот, нагенерить
  пакет статей по семантическому ядру, расширить тонкие тексты до 1500+ слов, подключить
  Вебмастер/Метрику/text.ru/xmlstock/kie.ai, развернуть бота заявок+диалога, или склонировать эту
  систему под новый сайт/нишу. Триггеры: «seo агент», «egorov_seo», «контент-автопилот»,
  «нагенери статьи по семантике», «расширь тексты до 1500», «публикуй по 5 в день».
---

# egorov_seo — автономный SEO/GEO контент-агент

Система, которая ведёт SEO-контент сайта без участия человека: собирает данные, генерирует статьи,
проверяет, публикует, переобходит, отчитывается. Эталонная реализация — проект `nalog-expert`
(сайт example.ru). Все рабочие скрипты лежат в `scripts/` этого скилла — копируй в проект
и адаптируй.

## Архитектура (разделение хостинга)

- **Сайт** — статика Astro, лежит на дешёвом РФ-хостинге (Reg.ru, FTP). Не требует Node.
- **Агент + бот** — на VPS (Node 18+, pm2, python3). Агент собирает сайт локально на VPS и
  заливает по FTP на хостинг. Заявки с формы идут через PHP-форвардер на самом хостинге (см. ниже),
  поэтому приём лидов НЕ зависит от VPS.

## Воркфлоу агента (`scripts/seo-agent/run.mjs`) — 6 шагов

1. **Сбор данных**: существующие страницы (покрытие тем), Я.Вебмастер (реальные запросы/позиции),
   Я.Метрика (трафик/поведение), xmlstock (SERP/конкуренция).
2. **Расширение ключей**: Sonnet генерит long-tail запросы по кластерам ниши, дедуп против покрытого.
3. **Gap-анализ**: ключи без страницы → оценка лёгкости входа (xmlstock) → топ-N кандидатов.
4. **Генерация + проверки** (`lib/generate-post.mjs`): Sonnet 4.6 → очеловечивание → **цикл добивания
   объёма ≥1500 слов** → детерминированный фактчек (слов≥1500, title≤60, desc≤165, internalLinks≥3,
   factbox, таблица, нет клише/плейсхолдеров) + **text.ru уникальность ≥82%** + LLM confidence ≥0.85.
5. **Публикация** (только live, `DRY_RUN=false`): запись MDX → `npm run build` → FTP-деплой →
   Я.Вебмастер recrawl + IndexNow → обновление llms.txt → запись в used-queries.
6. **Мониторинг + отчёт в Telegram** (создано/пропущено/ошибки/в топ-30/осталось в очереди).

## Два режима работы run.mjs

- **Очередь** (если `data/queue/` не пуста): берёт до `MAX_NEW` статей/день из очереди, гоняет
  text.ru только на них, ставит дату=сегодня, публикует. Так text.ru тратится экономно.
- **Живая генерация** (очередь пуста): генерит сам по gap-анализу.

## Массовая генерация (`scripts/seo-agent/generate-batch.mjs`)

`BATCH_COUNT=150 node scripts/seo-agent/generate-batch.mjs` — генерит N статей по семантике в очередь
`data/queue/` (Sonnet ≥1500 + структурный фактчек, БЕЗ text.ru — она на публикации). Резюмируемо,
шлёт прогресс в Telegram. Запускать на VPS в фоне: `nohup node ... &`. Дальше cron публикует по
`MAX_NEW`/день.

## Скрипты

| Скрипт | Назначение |
|---|---|
| `seo-agent/run.mjs` | Главный прогон (очередь или живая генерация). По cron. |
| `seo-agent/generate-batch.mjs` | Массовая генерация N статей в очередь. |
| `seo-agent/expand-existing.mjs` | Расширить существующие страницы до ≥1500 слов. |
| `seo-agent/cleanup-mdx.mjs` | Починить MDX: убрать import/JSX, ремонт factbox/якорей, экранировать `<`/`>`. |
| `seo-agent/competitor-analysis.mjs` | Анализ выдачи по кластерам (где легко в топ). |
| `seo-agent/test-apis.mjs` | Проверка связности интеграций. |
| `seo-agent/config.mjs` | Конфиг из `.env`, readiness(). |
| `seo-agent/lib/*` | Клиенты: xmlstock, aigate, textru, webmaster, metrika, indexnow, content, generate-post. |
| `bot/bot.mjs` | Telegram-бот: диалог по проекту (DeepSeek) + резервный лид-эндпоинт. |
| `images/kie-nb2.mjs`, `generate-set.mjs` | Картинки через kie.ai Nano Banana 2 + сжатие sharp. |
| `deploy-ftp.py` | Деплой `dist/` на FTP-хостинг (креды из `.env`). |

## Интеграции и эндпоинты (проверены рабочими)

- **xmlstock** (SERP/семантика): `https://xmlstock.com/yandex/xml/?user=&key=&query=&lr=225`.
- **aigate** (OpenAI-совм.): `https://api.aigate.shop/v1/chat/completions`, генерация — `anthropic/claude-sonnet-4.6`, диалог бота — `deepseek/deepseek-v4-pro`. Слать браузерный User-Agent.
- **text.ru**: `https://api.text.ru/post` (add→uid, затем poll по uid). Квота ограничена → проверять только публикуемые.
- **Я.Вебмастер v4**: `https://api.webmaster.yandex.net/v4` (OAuth-токен). user/{id}/hosts/{host}/search-queries/popular, /recrawl/queue, /user-added-sitemaps/. host_id вида `https:domain.ru:443`.
- **Я.Метрика**: `https://api-metrika.yandex.net/stat/v1/data` (тот же OAuth-токен, что Вебмастер — одно приложение на оба сервиса).
- **kie.ai** (картинки NB2): `POST /api/v1/jobs/createTask` {model:"nano-banana-2", input:{prompt, aspect_ratio, resolution, output_format:"png"}} → poll `/api/v1/jobs/recordInfo?taskId=`.
- **Telegram**: бот-токен от @BotFather, chat_id через getUpdates.

## Установка на НОВЫЙ сайт

1. Скопировать `scripts/` в корень Astro-проекта (`src/consts.ts` — единый источник правды: домен,
   эксперт/бренд, контакты).
2. `cp .env.example .env`, заполнить ключи (xmlstock, aigate, text.ru, Я.Вебмастер+Метрика OAuth,
   kie.ai, Telegram, FTP-креды хостинга, MAX_NEW_PAGES, BATCH_COUNT, DRY_RUN).
3. Адаптировать нишу: в `generate-post.mjs`/`generate-batch.mjs` — системный промпт и кластеры
   (`CLUSTERS`), в `bot/project-context.mjs` — знания бота о проекте.
4. `node scripts/seo-agent/test-apis.mjs` — проверить интеграции.
5. Подтвердить сайт в Я.Вебмастере (через Метрику — 1 клик), добавить sitemap, создать счётчик Метрики.
6. Лиды: положить PHP-форвардер `public/api/lead.php` на хостинг (читает форму, шлёт в Telegram),
   `PUBLIC_LEAD_ENDPOINT=/api/lead.php` (same-origin, без зависимости от VPS).

## Развёртывание на VPS (pm2 + cron)

```
# на VPS, /opt/<project>
npm install
pm2 start ecosystem.config.cjs --only <bot-name>   # бот 24/7
pm2 save && pm2 startup                              # автозапуск при reboot
# cron агента (UTC! 03:00 МСК = 00:00 UTC):
crontab -e →  0 0 * * * cd /opt/<project> && /usr/bin/node scripts/seo-agent/run.mjs >> logs/agent.cron.log 2>&1
# массовый батч (один раз, в фоне):
cd /opt/<project> && nohup node scripts/seo-agent/generate-batch.mjs > logs/batch.log 2>&1 &
```
Только ОДИН поллер Telegram на токен (останови локального бота перед запуском на VPS).

## Правила и грабли (важно!)

- **≥1500 слов** на каждой странице — жёстко. Генератор добивает циклом, фактчек режет <1500.
- **MDX ломается** на: голых `<`/`>` (сравнения), `import`/`export`, JSX-компонентах `<Component/>`.
  → `sanitizeMdx()` в `generate-post.mjs` это вычищает; в промптах запрещено import/JSX, сравнения
  писать словами; единственный разрешённый HTML — `<aside class="factbox">…</aside>`.
- **Reg.ru за прокси**: для http→https в `.htaccess` использовать `RewriteCond %{SERVER_PORT} !^443$`,
  НЕ `%{HTTPS} off` (иначе цикл редиректа кладёт сайт).
- **Деплой dist/ через FTP** (pathlib rglob включает dotfiles — `.htaccess` заливается).
- **Astro теряет scoped-стили** при `inlineStylesheets:'auto'` → ставить `inlineStylesheets:'never'`.
- **Фейковое фото реального эксперта НЕ генерировать** (E-E-A-T/этика) — только реальное; NB2 для
  концептуальных визуалов/обложек/OG.
- **Цифры лимитов/ставок 2026**, в которых не уверен, помечать «уточняется по НК РФ» — не выдумывать.
- **VPS бывает нестабилен** — сайт на отдельном хостинге это переживает; бот/cron возвращаются по
  pm2 startup.

## Частые команды

```
node scripts/seo-agent/test-apis.mjs              # проверка интеграций
node scripts/seo-agent/competitor-analysis.mjs    # где легко в топ
DRY_RUN=true MAX_NEW_PAGES=1 node scripts/seo-agent/run.mjs   # тест без публикации
node scripts/seo-agent/expand-existing.mjs        # добить тексты до 1500+
node scripts/seo-agent/cleanup-mdx.mjs            # починить MDX
BATCH_COUNT=150 node scripts/seo-agent/generate-batch.mjs    # массовая генерация
npm run build && python scripts/deploy-ftp.py     # ручной деплой
```
