// Единый ежедневный отчёт к 12:00 МСК (09:00 UTC). Отдельный от ночного прогона генерации.
// Блоки: Трафик · Источники · Страницы · Позиции · Рекомендации · Расходы в $.
// Запуск: node scripts/seo-agent/daily-report.mjs
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR, readiness } from './config.mjs';
import { metrikaReady, metrikaToday, trafficSourcesToday } from './lib/metrika.mjs';
import { webmasterReady, popularQueries, summary as webmasterSummary, demandGaps } from './lib/webmaster.mjs';
import { balance as contentwatchBalance, contentwatchReady } from './lib/contentwatch.mjs';
import { credits as kieCredits } from '../images/kie-nb2.mjs';
import { getCosts } from './lib/cost-ledger.mjs';
import { auditQualityFromDist, qualityReportLine, enrichmentQueue } from './lib/quality-gates.mjs';
import { auditDist, onpageReportLine } from './lib/onpage-audit.mjs';
import { validateDist, schemaReportLine } from './lib/schema-validate.mjs';
import { pageSpeed, cwvReportLine } from './lib/pagespeed.mjs';
import { existingPages, fileForUrl } from './lib/content.mjs';
import { sendMessage, escapeHtml } from '../bot/telegram.mjs';
import { sendReportLines } from '../bot/rich.mjs';
import { PROFILE } from '../../site.profile.mjs';

const STATE_FILE = join(ROOT_DIR, 'scripts/seo-agent/data/report-state.json');
const today = () => new Date().toISOString().slice(0, 10);

function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf-8')); } catch { return {}; }
}
function saveState(state) {
  mkdirSync(join(ROOT_DIR, 'scripts/seo-agent/data'), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

const fmtDuration = (sec) => `${Math.floor(sec / 60)}м ${Math.round(sec % 60)}с`;
const fmtUsd = (n) => `$${n.toFixed(2)}`;

async function main() {
  const state = loadState();
  const lines = [`<b>📊 Ежедневный отчёт — ${PROFILE.bot?.projectName || ROOT_DIR.split(/[\\/]/).pop()}</b> (${today()})`];

  // ── БЛОК Трафик ──
  if (metrikaReady()) {
    const t = await metrikaToday();
    lines.push(
      '',
      '<b>📈 Трафик</b>',
      `Визиты сегодня: ${t.visits}`,
      `Пользователи сегодня: ${t.users}`,
      `Отказы сегодня: ${t.bounce.toFixed(1)}%`,
      `Среднее время на сайте сегодня: ${fmtDuration(t.avgDuration)}`,
      `Кол-во просмотренных страниц сегодня: ${t.pageviews}`,
    );

    // ── БЛОК Источники ──
    const src = await trafficSourcesToday();
    lines.push(
      '',
      '<b>🔗 Источники</b>',
      `• Direct traffic сегодня: ${src.direct}`,
      `• Internal traffic сегодня: ${src.internal}`,
      `• Messenger traffic сегодня: ${src.messenger}`,
      `• Search engine traffic сегодня: ${src.search}`,
      `• Link traffic сегодня: ${src.link}`,
    );
  } else {
    lines.push('', '<b>📈 Трафик</b>', 'Я.Метрика не настроена.');
  }

  // ── БЛОК Страницы ──
  const pages = existingPages();
  const runLog = readTodaysCreatedFromLog();
  const totalPages = pages.length;
  const wmSum = webmasterReady() ? await webmasterSummary() : null;
  const indexedToday = wmSum?.searchable ?? null;
  const indexedYesterday = state.indexedPages ?? null;
  const indexedDelta = indexedToday != null && indexedYesterday != null ? indexedToday - indexedYesterday : null;

  lines.push(
    '',
    '<b>📄 Страницы</b>',
    indexedToday != null
      ? `Страниц в индексе: ${indexedToday}${indexedDelta != null ? ` (${indexedDelta >= 0 ? '+' : ''}${indexedDelta} с прошлого отчёта)` : ''}`
      : 'Страниц в индексе: нет данных Вебмастера',
    `Страниц создано сегодня: ${runLog.length} | итого в проекте: ${totalPages}`,
  );
  if (runLog.length) {
    lines.push('Ссылки на новые опубликованные страницы:');
    for (const u of runLog) lines.push(`• ${escapeHtml(u)}`);
  }

  // ── БЛОК Позиции в поиске ──
  if (webmasterReady()) {
    const queries = await popularQueries({ limit: 200 });
    const withPos = queries.filter((q) => q.position != null);
    const top10 = withPos.filter((q) => q.position <= 10).length;
    const top50 = withPos.filter((q) => q.position <= 50).length;
    const top100 = withPos.filter((q) => q.position <= 100).length;

    const prevPositions = state.positions || {};
    const newPositions = {};
    const trended = withPos.slice(0, 15).map((q) => {
      newPositions[q.query] = q.position;
      const prev = prevPositions[q.query];
      let arrow = '🆕';
      if (prev != null) {
        if (q.position < prev - 0.5) arrow = '▲';
        else if (q.position > prev + 0.5) arrow = '▼';
        else arrow = '·';
      }
      return `${arrow} поз. ${q.position.toFixed(1)} — ${q.query}`;
    });
    state.positions = { ...prevPositions, ...newPositions };

    lines.push(
      '',
      '<b>🔍 Позиции в поиске</b>',
      `ТОП 10: ${top10} · ТОП 50: ${top50} · ТОП 100: ${top100}`,
      '▲ рост позиции · ▼ падение · 🆕 новый (с прошлого отчёта)',
      ...trended.map((s) => escapeHtml(s)),
    );
  } else {
    lines.push('', '<b>🔍 Позиции в поиске</b>', 'Я.Вебмастер не настроен.');
  }

  // ── БЛОК Высокий спрос, мы не в топе (DEMAND) ──
  // Эти же запросы агент берёт в работу (генерацию новых страниц) на ночном прогоне run.mjs.
  if (webmasterReady()) {
    try {
      const gaps = await demandGaps({ top: 6 });
      if (gaps.length) {
        lines.push(
          '',
          '<b>📈 Высокий спрос, мы не в топе</b>',
          ...gaps.map((g) => `• ${escapeHtml(g.query)} — спрос ${g.demand.toFixed(2)}`),
          '<i>Эти запросы автоматически в очереди на генерацию.</i>',
        );
      }
    } catch { /* игнор — блок необязательный */ }
  }

  // ── БЛОК Рекомендации ──
  const recs = [];
  if (metrikaReady()) {
    const t = await metrikaToday();
    if (t.visits > 0 && t.bounce > 70) recs.push('Высокий процент отказов — усилить CTA/перелинковку на посадочных.');
    if (t.visits > 5 && t.avgDuration < 30) recs.push('Низкое время на сайте — проверить релевантность контента запросам.');
  }
  if (runLog.length === 0) recs.push('Сегодня не опубликовано новых страниц — проверить очередь/лог агента.');
  lines.push('', '<b>💡 Рекомендации</b>', recs.length ? recs.map((r) => '• ' + escapeHtml(r)).join('\n') : 'Без замечаний.');

  // ── БЛОК Расходы в $ за сегодня ──
  const costs = getCosts();
  const cwToday = contentwatchReady() ? await contentwatchBalance().catch(() => null) : null;
  const cwSpentRub = cwToday && state.cwBalance != null ? Math.max(0, state.cwBalance - cwToday.balance) : null;
  const kieBal = await kieCredits().catch(() => null);       // общий баланс аккаунта (справочно)
  const kieImgs = costs.calls['kie'] || 0;                    // свои картинки этого проекта за день
  const kieUsd = costs.usd['kie'] || 0;                       // реальный $ этого проекта

  lines.push(
    '',
    '<b>💰 Расходы за сегодня</b>',
    `Сообщения в боте (aigate): ${fmtUsd(costs.usd['aigate-dialog'] || 0)}`,
    `Создание новых текстов (aigate): ${fmtUsd(costs.usd['aigate-generation'] || 0)}`,
    cwSpentRub != null ? `Проверка текстов content-watch.ru: ${cwSpentRub.toFixed(2)}₽` : 'Проверка текстов content-watch.ru: нет данных за прошлый отчёт (баланс сохранён на завтра)',
    `Сервис Arsenkin: ${sumCalls(costs.calls, 'arsenkin-')} запрос(ов) (баланс через API не публикует — фиксировано подпиской)`,
    `Сервис xmlstock: ${costs.calls['xmlstock'] || 0} запрос(ов) (баланс через API не публикует)`,
    kieImgs > 0 ? `Сервис kie.ai: ${kieImgs} картинок (~${fmtUsd(kieUsd)})` : 'Сервис kie.ai: не использовался (картинки — Pollinations, бесплатно)',
  );
  if (kieBal != null) lines.push(`<i>Баланс kie.ai (общий аккаунт): ${Math.round(kieBal)} кредитов</i>`);

  // ── БЛОК Качество и техника (гейты качества, адаптировано из claude-seo) ──
  try {
    const distDir = join(ROOT_DIR, 'dist');
    const qa = auditQualityFromDist(distDir);
    const oa = existsSync(distDir) ? auditDist(distDir) : null;
    const sc = validateDist(distDir);
    const siteUrl = process.env.SITE_URL || '';
    const ps = siteUrl ? await pageSpeed(siteUrl, { strategy: 'mobile' }).catch(() => null) : null;
    let enqLine = null;
    if (qa) { try { const enq = enrichmentQueue(qa, fileForUrl); writeFileSync(join(ROOT_DIR, 'scripts/seo-agent/data/enrichment-queue.json'), JSON.stringify(enq, null, 2)); enqLine = `В очереди на обогащение: ${enq.articles.length} статей (expand-existing) · ${enq.cards.length} карточек (ЖК-обогащение)`; } catch {} }
    const qlines = [qualityReportLine(qa), enqLine, onpageReportLine(oa), schemaReportLine(sc), ps ? cwvReportLine(ps) : null].filter(Boolean);
    if (qlines.length) lines.push('', '<b>🔎 Качество и техника</b>', ...qlines.map((l) => '• ' + l));
  } catch (e) { /* необязательный блок */ }

  // ── Сохранить состояние на завтра ──
  if (indexedToday != null) state.indexedPages = indexedToday;
  if (cwToday) state.cwBalance = cwToday.balance;
  saveState(state);

  const report = lines.filter((l) => l !== undefined).join('\n');
  console.log(report.replace(/<\/?b>/g, ''));
  if (readiness().telegram) await sendReportLines(lines);
}

function sumCalls(calls, prefix) {
  return Object.entries(calls).filter(([k]) => k.startsWith(prefix)).reduce((s, [, v]) => s + v, 0);
}

/** Новые страницы из ПОСЛЕДНЕГО завершённого прогона run.mjs (не всего лога целиком —
 * при ежедневном cron последний прогон и есть «сегодня»). Парсит блок после последнего
 * "Опубликовано:" до следующей несписочной строки. */
function readTodaysCreatedFromLog() {
  const logPath = join(ROOT_DIR, 'logs/agent.cron.log');
  if (!existsSync(logPath)) return [];
  try {
    const lines = readFileSync(logPath, 'utf-8').split('\n');
    const lastPublishedIdx = lines.map((l) => /^Опубликовано:/.test(l) ? 1 : 0).lastIndexOf(1);
    if (lastPublishedIdx === -1) return [];
    const urls = [];
    for (let i = lastPublishedIdx + 1; i < lines.length; i++) {
      const m = lines[i].match(/^• (\/\S+\/)$/);
      if (m) urls.push(m[1]);
      else break;
    }
    return urls;
  } catch { return []; }
}

main().catch((e) => { console.error('[daily-report] FATAL', e); process.exit(1); });
