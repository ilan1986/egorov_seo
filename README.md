# egorov_seo — автономный SEO/GEO-агент (Claude Code skill)

Скилл для Claude Code: **автономный SEO/GEO-специалист**, который сам ведёт сайты — изучает
нишу, работает с реальной семантикой, создаёт и оптимизирует контент, публикует, следит за
индексацией и цитируемостью нейросетями, а рискованные действия согласует с человеком через
Telegram. Работает в двух режимах: **свои сайты** и **клиентские сайты (агентство)**.

> Всё через конфиг — методика ядра одна, а каждый сайт описывается своим `site.profile.mjs`.
> Ключи и доступы — только в `.env` (в репозитории их нет; см. `.env.example`).

## Что умеет

**Автономный агент (ReAct-цикл `perceive → decide → act`)**
- Восприятие: живые метрики (Яндекс.Метрика — трафик/заявки, Вебмастер — спрос), позиции, бюджет.
- Решение через **AI SDK tool-calling** — модель обязана выбрать инструмент из реестра (без парс-сбоев
  и галлюцинаций несуществующих тулзов), с учётом журнала и дневного бюджета.
- Действия: генерация статьи, переписывание title/description под CTR, дозапись тонких страниц,
  освежение под свежесть/E-E-A-T, замер AI-цитируемости, проверка дрейфа/здоровья.
- Класс риска: `auto` (делает сам) / `approve` (предлагает человеку → `/approve` в Telegram).
- Зонд возможностей сервера + первый запуск (`onboard.mjs`): понимает, зачем его используют, и
  разворачивает нужный тулсет.

**Контент и семантика**
- Реальная частотность и SERP (Wordstat/Arsenkin/XML) — без выдуманных ключей.
- **keys.so** (опт-ин): striking-distance (частотные запросы на позициях 11–30 → дожать), органические
  и Директ-конкуренты + их рекламные ключи (ядро для нейро-директолога).
- Генерация с фактчеком, проверкой уникальности и **quality-gate** (promptfoo): блокирует воду/клише
  и тонкий контент до публикации; blocklist не даёт писать про конкурентов.
- Кластеризация, content-brief, перелинковка, авторские/Article/FAQ/Person schema.

**Публикация**
- Astro → сборка → FTP/SSH на хостинг (по умолчанию), либо напрямую в **Joomla 4/5 через REST API** —
  цель выбирается в `site.profile.mjs`.
- Обложки статей: через llm-proxy (Flux/Imagen) либо реальные фото зданий из Pixabay (`IMAGE_PROVIDER=pixabay`),
  без платных генераторов; сцены под нишу — `generation.coverScenes`; переиндексация через IndexNow + Яндекс.Вебмастер.

**GEO (оптимизация под ответы нейросетей)**
- Citability-скоринг, `llms.txt`, GEO-директивы, E-E-A-T, свежесть.
- **AI Share of Voice** — измеряет реальную цитируемость через web-grounded модель (Perplexity Sonar):
  видит, какие домены выигрывают AI-ответ, и попал ли туда сайт.

**Аудит и агентские инструменты**
- Глубокий аудит клиентского сайта (Crawlee: обход всего сайта + JS-рендер), детект local/ecommerce.
- PDF-отчёт и КП (единые SEO+GEO, с графиками ECharts, рендер через gotenberg).
- CRM-воронка клиентов, авто-поиск кандидатов, черновики первого касания.

**Аналитика и рост**
- Своя cookieless-аналитика (Umami) и A/B-тесты форм (GrowthBook) через first-party-прокси.
- Crawl-аналитика логов (goaccess): кто краулит, ходят ли ИИ-боты, битые URL глазами ботов.
- Индексация (IndexNow), мониторинг позиций, дейли-репорт в Telegram.

## Структура

```
SKILL.md                     # инструкция скилла для Claude Code
.env.example                 # список переменных окружения (значения — свои, локально)
scripts/seo-agent/
  agent.mjs                  # автономный ReAct-цикл
  onboard.mjs                # первый запуск: режим + зонд возможностей + план
  run.mjs                    # линейный конвейер генерации/оптимизации/публикации
  ai-citation-probe.mjs      # AI Share of Voice (Perplexity Sonar)
  generate-one.mjs           # разовая генерация одной статьи по ключу
  test-joomla.mjs            # проверка соединения с Joomla REST
  lib/                        # capabilities, agent-tools, decide-aisdk, agent-journal,
                              # citability, geo-score, drift, charts, logaudit, deepcrawl,
                              # keysso (keys.so), publish/publish-joomla, blocklist,
                              # quality-gate, client-audit/report, proposal, prospect, ...
  quality/                    # promptfoo quality-gate
scripts/images/               # images (диспетчер), pixabay, proxy-image, pollinations (резерв, выкл), kie-nb2
scripts/bot/                  # telegram-бот согласований + site-state
scripts/templates/            # robots.geo, политика/cookie/consent, lead.php (форвардер заявок)
```

## Быстрый старт

1. Скопируйте `.env.example` → `.env` и заполните своими ключами.
2. Опишите сайт в `site.profile.mjs` (см. `templates/site.profile.example.mjs`).
3. Первый запуск: `node scripts/seo-agent/onboard.mjs own` (или `client`).
4. Наблюдательный прогон агента: `AGENT_DRY=1 node scripts/seo-agent/agent.mjs`.
5. Боевой (по расписанию): `DRY_RUN=false node scripts/seo-agent/agent.mjs` в cron, дневной бюджет
   задаётся в профиле (`autonomy.dailyBudgetUsd`).

## Безопасность

- Секреты (`.env`, ключи, пароли, FTP, токены) в репозиторий **не попадают** — см. `.gitignore`.
- Рискованные/наружу-видимые действия агент выполняет только после подтверждения человека.
- Мин. пороги качества и фактчек — до публикации.

---

Стек: Node.js (ESM), Astro/Joomla-сайты, LLM через локальный llm-proxy + OpenAI-совместимые шлюзы
(closerouter/anymodel/wellflow, перебор по кругу при сбое), Yandex Webmaster/Metrika,
Wordstat/Arsenkin/XML/keys.so, Perplexity Sonar, Pixabay/Flux (llm-proxy), Crawlee/Playwright, promptfoo,
ECharts, gotenberg, Umami, GrowthBook, Telegram Bot API.
