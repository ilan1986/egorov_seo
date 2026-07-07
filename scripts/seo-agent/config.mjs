// Загрузка .env и единый конфиг для SEO-агента и бота.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../'); // корень Astro-проекта, куда установлен агент

// Node 21+/24: нативная загрузка .env
try {
  process.loadEnvFile(resolve(ROOT, '.env'));
} catch {
  // .env может отсутствовать — переменные могут прийти из окружения
}

const env = (k, def = '') => process.env[k] ?? def;

export const ROOT_DIR = ROOT;

export const CONFIG = {
  siteUrl: env('SITE_URL', 'https://example.ru'),

  xmlstock: {
    user: env('XMLSTOCK_USER'),
    key: env('XMLSTOCK_KEY'),
    lr: env('XMLSTOCK_LR', '225'),
  },
  aigate: {
    baseUrl: env('AIGATE_BASE_URL', 'https://api.aigate.shop/v1'),
    key: env('AIGATE_API_KEY'),
    model: env('AIGATE_MODEL', 'anthropic/claude-sonnet-4.6'),
    dialogModel: env('DIALOG_MODEL', 'deepseek/deepseek-v4'),
  },
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
  indexNowKey: env('INDEXNOW_KEY'),
  telegram: {
    token: env('TELEGRAM_BOT_TOKEN'),
    chatId: env('TELEGRAM_CHAT_ID'),
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
  };
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
export const DEFAULT_HEADERS = { 'User-Agent': BROWSER_UA };
