// Зонд возможностей окружения. При первом запуске агент смотрит, что сервер/конфиг реально тянет,
// и докладывает пользователю: какие инструменты доступны, какие нет и что из-за этого недоступно.
// Ничего не меняет — только проверяет (fetch к localhost-сервисам, resolve npm-модулей, env-ключи).
import { execFileSync } from 'node:child_process';
import { totalmem, freemem, cpus } from 'node:os';

async function svc(url, ms = 2500) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.ok || r.status === 404 || r.status === 401; } catch { return false; }
}
function hasModule(name) { try { return !!import.meta.resolve(name); } catch { try { execFileSync('node', ['-e', `require.resolve(${JSON.stringify(name)})`], { stdio: 'pipe' }); return true; } catch { return false; } } }
function hasBin(bin, args = ['--version']) { try { execFileSync(bin, args, { stdio: 'pipe', timeout: 8000 }); return true; } catch { return false; } }
const envHas = (k) => !!(process.env[k] && process.env[k].trim());

/**
 * @param {object} [opts] { services?: {gotenberg,umami,growthbook,formbricks} — базовые URL }
 * @returns {Promise<{system, capabilities:Array<{key,name,ok,enables,fallback}>}>}
 */
export async function probeCapabilities(opts = {}) {
  const S = {
    gotenberg: (opts.services?.gotenberg) || 'http://localhost:3009/health',
    umami: (opts.services?.umami) || 'http://localhost:3011/api/heartbeat',
    growthbook: (opts.services?.growthbook) || 'http://localhost:3100/',
    formbricks: (opts.services?.formbricks) || 'http://localhost:3013/',
  };
  const [gotenberg, umami, growthbook, formbricks] = await Promise.all([svc(S.gotenberg), svc(S.umami), svc(S.growthbook), svc(S.formbricks)]);

  const crawlee = hasModule('crawlee');
  const playwright = hasModule('playwright');
  const echarts = hasModule('echarts');
  const promptfoo = hasBin('npx', ['promptfoo', '--version']) || hasModule('promptfoo');
  const basicFtp = hasModule('basic-ftp');
  const goaccess = hasBin('goaccess');
  const wkhtml = hasBin('wkhtmltopdf');

  const cap = (key, name, ok, enables, fallback = null) => ({ key, name, ok, enables, fallback });
  const capabilities = [
    // Контент/семантика
    // llm — ЛЮБОЙ провайдер цепочки фолбэка (aigate/closerouter/anymodel/wellflow) или локальный прокси (AIGATE_BASE_URL).
    // Раньше гейт был только на AIGATE_API_KEY → если он пуст (напр. Врадок на прокси), generate_article выпадал из
    // каталога и агент НЕ МОГ генерить статьи, хотя LLM реально работал через резерв. Теперь отражает реальную доступность.
    cap('llm', 'Генерация/оценка контента (LLM)', envHas('AIGATE_API_KEY') || envHas('CLOSEROUTER_API_KEY') || envHas('ANYMODEL_API_KEY') || envHas('WELLFLOW_API_KEY') || envHas('AIGATE_BASE_URL'), 'генерация страниц, quality-gate, ИИ-чат', 'без ключей — контент-модули не работают'),
    cap('semantics', 'Семантика (Wordstat/Arsenkin/XML)', envHas('ARSENKIN_TOKEN') || envHas('ARSENKIN_API_KEY') || envHas('XMLSTOCK_KEY') || envHas('WORDSTAT_TOKEN'), 'реальная частотность ключей, SERP-анализ', 'без ключей — только эвристики, риск выдумок'),
    cap('quality_gate', 'Quality-gate (promptfoo)', promptfoo && (envHas('AIGATE_API_KEY') || envHas('CLOSEROUTER_API_KEY') || envHas('AIGATE_BASE_URL')), 'блокировка слабого/водянистого контента до публикации', 'без него — только правило мин. объёма'),
    // Аудит/краулинг
    cap('deep_crawl', 'Глубокий аудит + JS-сайты (Crawlee)', crawlee, 'обход всего сайта, битые ссылки, парсер lead-gen', 'без него — быстрый аудит по 6 URL из sitemap'),
    cap('js_render', 'Рендер SPA/JS-сайтов (Playwright)', playwright, 'аудит клиент-рендер сайтов (React/Vue)', 'без него — только статический HTML'),
    cap('crawl_logs', 'Crawl-аналитика логов (goaccess+FTP)', goaccess && basicFtp, 'кто краулит, ИИ-боты, битые URL глазами ботов', 'без FTP-логов — нет данных о ботах'),
    // Документы/отчёты
    cap('pdf', 'PDF-отчёты/КП', gotenberg || wkhtml, 'отчёты и КП клиенту в PDF', gotenberg ? null : (wkhtml ? 'через wkhtmltopdf' : 'нет движка PDF — только HTML')),
    cap('charts', 'Графики в отчётах (ECharts)', true, 'gauge/бары/пончик в отчётах', echarts ? null : 'встроенный SVG-fallback (echarts не нужен)'),
    // Внешние сервисы
    cap('analytics', 'Своя аналитика (Umami)', umami, 'cookieless-аналитика трафика, единый дашборд', 'без неё — только Яндекс.Метрика'),
    cap('ab', 'A/B-тесты форм (GrowthBook)', growthbook, 'сплит-тесты CTA/форм + статистика', 'без него — без A/B'),
    cap('popups', 'Попапы/лид-магниты (Formbricks)', formbricks, 'exit-intent попапы, сбор email', 'без него — обычные формы'),
    cap('media', 'Медиа-генерация (kie.ai/HeyGen)', envHas('KIE_API_KEY') || envHas('HEYGEN_API_KEY'), 'обложки, видео-эксперт, картинки', 'без ключей — без генерации медиа'),
    // Коммуникация
    cap('bot', 'ТГ-бот проекта', envHas('TELEGRAM_BOT_TOKEN'), 'отчёты, /approve, бюджет-стоп, коммуникация', 'без токена — нет канала связи с агентом'),
    cap('leads', 'Сбор заявок с форм', envHas('LEADS_KEY'), 'заявки сайта в боте', 'без ключа — заявки не читаются'),
    cap('deploy', 'Деплой на хостинг (FTP)', envHas('FTP_HOST') || basicFtp, 'публикация изменений на живой сайт', 'без FTP — только локальная сборка'),
  ];

  return {
    system: {
      ramTotalMb: Math.round(totalmem() / 1048576),
      ramFreeMb: Math.round(freemem() / 1048576),
      cpus: cpus().length,
      node: process.version,
      diskFreeGb: diskFreeGb(),
    },
    services: { gotenberg, umami, growthbook, formbricks },
    capabilities,
  };
}

function diskFreeGb() {
  try { const out = execFileSync('df', ['-BG', '/'], { stdio: 'pipe' }).toString().trim().split('\n').pop().split(/\s+/); return parseInt(out[3]); } catch { return null; }
}

/** Человекочитаемый отчёт (для бота/лога) — что можем и чего нет. */
export function fmtCapabilities(rep, mode) {
  const s = rep.system;
  const L = [];
  L.push(`🖥 <b>Конфиг сервера</b>: RAM ${s.ramFreeMb}/${s.ramTotalMb}МБ своб · ${s.cpus} CPU · диск ${s.diskFreeGb ?? '?'}ГБ своб · Node ${s.node}`);
  if (mode) L.push(`🎯 Режим: <b>${mode === 'client' ? 'продвижение клиентских сайтов' : 'свои сайты'}</b>`);
  L.push('');
  const ok = rep.capabilities.filter((c) => c.ok);
  const no = rep.capabilities.filter((c) => !c.ok);
  L.push(`✅ <b>Доступно (${ok.length})</b>:`);
  // для доступных показываем только «инженерную» заметку (напр. через wkhtmltopdf / SVG-fallback),
  // а не последствие отсутствия (текст «без …» относится к недоступным).
  for (const c of ok) { const note = c.fallback && !/^без /i.test(c.fallback) ? ` <i>(${c.fallback})</i>` : ''; L.push(`  • ${c.name}${note}`); }
  if (no.length) {
    L.push('');
    L.push(`⚠️ <b>Недоступно (${no.length})</b> — что теряем:`);
    for (const c of no) L.push(`  • ${c.name}: ${c.fallback || c.enables}`);
  }
  return L.join('\n');
}

/** Проверка достаточности под выбранный режим: чего критично не хватает. */
export function gapsForMode(rep, mode) {
  const need = mode === 'client'
    ? ['llm', 'semantics', 'pdf', 'bot', 'deep_crawl']       // агентству: аудит+КП+отчёты+бот
    : ['llm', 'semantics', 'deploy', 'bot', 'quality_gate']; // своим: генерация+деплой+гейт+бот
  const map = Object.fromEntries(rep.capabilities.map((c) => [c.key, c.ok]));
  return need.filter((k) => !map[k]);
}
