// Загрузка .env и единый конфиг для SEO-агента и бота.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../'); // корень проекта nalog-expert

// Node 21+/24: нативная загрузка .env
try {
  process.loadEnvFile(resolve(ROOT, '.env'));
} catch {
  // .env может отсутствовать — переменные могут прийти из окружения
}

const env = (k, def = '') => process.env[k] ?? def;

export const ROOT_DIR = ROOT;

// LLM-провайдеры по порядку приоритета: основной + резервы (клиент перебирает по кругу при сбое).
// Каждый OpenAI-совместим. Модели у провайдеров называются по-разному — генерация Sonnet-класс, диалог дешевле.
// Ключи и модели можно переопределить в .env; провайдер без ключа автоматически пропускается.
//
// Локальный llm-proxy (AIGATE_BASE_URL, напр. http://127.0.0.1:8791/v1): если он поднят на VPS —
// делаем ЕГО основным. У прокси свой устойчивый внутренний фолбэк (aigate→closerouter→anymodel→wellflow
// + подмена модели), и он на localhost: быстрый ответ без ожидания внешних 502/зависаний closerouter и
// anymodel (из-за которых прогон генерации мог висеть до 200с на каждый шаг и фактически не производить
// контент). Ключ прокси не требуется (локальный сервис игнорирует Authorization), но фильтр провайдеров
// в aigate.mjs требует truthy key — поэтому подставляем 'local', когда AIGATE_API_KEY пуст. Прямые
// closerouter/anymodel/wellflow остаются резервами на случай падения самого прокси.
const AIGATE_BASE = env('AIGATE_BASE_URL').replace(/\/+$/, '');
const PROXY = AIGATE_BASE
  ? [{
      name: 'llm-proxy',
      baseUrl: AIGATE_BASE,
      key: env('AIGATE_API_KEY') || 'local',
      model: env('AIGATE_MODEL', 'anthropic/claude-sonnet-4.6'),
      dialogModel: env('AIGATE_DIALOG_MODEL', env('DIALOG_MODEL', 'google/gemini-3.7-flash')),
    }]
  : [];
const PROVIDERS = [
  ...PROXY,
  {
    name: 'closerouter',
    baseUrl: env('CLOSEROUTER_BASE_URL', 'https://api.closerouter.dev/v1'),
    key: env('CLOSEROUTER_API_KEY'),
    model: env('CLOSEROUTER_MODEL', 'anthropic/claude-sonnet-4.6'),
    // openai/gpt-5.4-mini у closerouter отдаёт 502 «no healthy provider route» (12.09.2026)
    dialogModel: env('CLOSEROUTER_DIALOG_MODEL', 'google/gemini-3.7-flash'),
  },
  {
    name: 'anymodel',
    baseUrl: env('ANYMODEL_BASE_URL', 'https://anymodel.org/v1'),
    key: env('ANYMODEL_API_KEY'),
    model: env('ANYMODEL_MODEL', 'cc/claude-sonnet-4-6'),
    // cx/gpt-5.4-mini снят anymodel 08.09.2026 (404 с подсказкой перейти на другую модель)
    dialogModel: env('ANYMODEL_DIALOG_MODEL', 'ag/gemini-3.7-flash-medium'),
  },
  {
    name: 'wellflow',
    baseUrl: env('WELLFLOW_BASE_URL', 'https://api.wellflow.dev/v1'),
    key: env('WELLFLOW_API_KEY'),
    model: env('WELLFLOW_MODEL', 'qwen3.7-max'),
    dialogModel: env('WELLFLOW_DIALOG_MODEL', 'qwen3.5-flash'),
  },
];

/**
 * Порядок провайдеров можно переопределить: LLM_PRIMARY=anymodel поднимает названного
 * наверх, остальные остаются резервом в прежнем порядке. Нужно, когда основную нагрузку
 * должен нести конкретный аккаунт — например, ключ клиента, а не общий пул подрядчика.
 */
const PRIMARY = env('LLM_PRIMARY').trim().toLowerCase();
const ORDERED = PRIMARY
  ? [...PROVIDERS].sort((a, b) => (a.name === PRIMARY ? -1 : b.name === PRIMARY ? 1 : 0))
  : PROVIDERS;

export const CONFIG = {
  siteUrl: env('SITE_URL', 'https://example.ru'),

  xmlstock: {
    user: env('XMLSTOCK_USER'),
    key: env('XMLSTOCK_KEY'),
    lr: env('XMLSTOCK_LR', '225'),
  },
  providers: ORDERED,
  aigate: ORDERED[0], // алиас основного провайдера для обратной совместимости (сервис aigate выведен из цепочки — теперь это closerouter)
  textru: {
    key: env('TEXTRU_KEY'),
    minUnique: Number(env('TEXTRU_MIN_UNIQUE', '82')),
  },
  contentwatch: {
    key: env('CONTENTWATCH_KEY'),
    minUnique: Number(env('CONTENTWATCH_MIN', env('TEXTRU_MIN_UNIQUE', '82'))),
  },
  yandexWebmaster: {
    token: env('YANDEX_WEBMASTER_TOKEN'),
    userId: env('YANDEX_WEBMASTER_USER_ID'),
    hostId: env('YANDEX_WEBMASTER_HOST_ID'),
  },
  yandexMetrika: {
    token: env('YANDEX_METRIKA_TOKEN'),
    counter: env('YANDEX_METRIKA_COUNTER'),
  },
  kie: {
    key: env('KIE_API_KEY'),
    baseUrl: env('KIE_BASE_URL', 'https://api.kie.ai'),
  },
  arsenkin: {
    key: env('ARSENKIN_API_KEY'),
    region: Number(env('ARSENKIN_REGION', '225')),
  },
  // Topvisor — трекинг позиций (в т.ч. Google). ОПТ-ИН: работает только если задан ключ+User-Id.
  // ВАЖНО: User-Id — ЧИСЛОВОЙ id аккаунта (напр. 3962), НЕ email. Иначе «Authorisation error».
  topvisor: {
    userId: env('TOPVISOR_USER_ID', env('TOPVISOR_LOGIN')), // числовой id (обратная совместимость)
    key: env('TOPVISOR_KEY'),          // API-ключ
    projectId: env('TOPVISOR_PROJECT_ID'),
  },
  // Google-канал — ОПТ-ИН: по умолчанию агент на Яндексе. Включается кредами GSC (см. lib/gsc.mjs).
  google: {
    saJson: env('GOOGLE_SA_JSON'),
    gscSite: env('GSC_SITE_URL'),
  },
  indexNowKey: env('INDEXNOW_KEY'),
  telegram: {
    token: env('TELEGRAM_BOT_TOKEN'),
    chatId: env('TELEGRAM_CHAT_ID'),
    siteTag: env('SITE_TAG'),
    leadPort: Number(env('LEAD_PORT', '8787')),
  },
  max: {
    botToken: env('MAX_BOT_TOKEN'),
  },
  agent: {
    maxNew: Number(env('MAX_NEW_PAGES', '3')),
    dryRun: env('DRY_RUN', 'true') === 'true',
    minConfidence: Number(env('CONFIDENCE_MIN', '0.85')),
  },
};

/** Какие интеграции готовы (ключ задан). */
export function readiness() {
  return {
    xmlstock: Boolean(CONFIG.xmlstock.user && CONFIG.xmlstock.key),
    aigate: Boolean(CONFIG.aigate.key),
    textru: Boolean(CONFIG.textru.key),
    contentwatch: Boolean(CONFIG.contentwatch.key),
    uniqueness: Boolean(CONFIG.contentwatch.key || CONFIG.textru.key),
    yandexWebmaster: Boolean(CONFIG.yandexWebmaster.token),
    yandexMetrika: Boolean(CONFIG.yandexMetrika.token),
    telegram: Boolean(CONFIG.telegram.token),
    arsenkin: Boolean(CONFIG.arsenkin.key),
    topvisor: Boolean(CONFIG.topvisor.key && CONFIG.topvisor.userId),
    google: Boolean(CONFIG.google.saJson && CONFIG.google.gscSite), // Google-канал включён (опт-ин)
  };
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
export const DEFAULT_HEADERS = { 'User-Agent': BROWSER_UA };
