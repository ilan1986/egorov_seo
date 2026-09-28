// Еженедельный отчёт по позициям в Яндексе → Telegram. Запуск: node scripts/seo-agent/positions-report.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONFIG, ROOT_DIR, readiness } from './config.mjs';
import { sendMessage, escapeHtml } from '../bot/telegram.mjs';
import { summary, diagnostics, externalLinksCount, searchEvents, brokenInternalLinks } from './lib/webmaster.mjs';
import { diagLabel } from './lib/health.mjs';
import { metrikaReady, metrikaTotals, metrikaSources, metrikaLanding, metrikaPhrases } from './lib/metrika.mjs';

const { token, userId, hostId } = CONFIG.yandexWebmaster;
const H = { Authorization: `OAuth ${token}`, 'User-Agent': 'Mozilla/5.0' };
const B = 'https://api.webmaster.yandex.net/v4';
const u = encodeURIComponent(hostId);
const HIST = resolve(ROOT_DIR, 'scripts/seo-agent/data/positions-history.json');

async function main() {
  if (!readiness().yandexWebmaster) { console.log('нет токена Вебмастера'); return; }

  // запросы с позициями
  const q =
    `/user/${userId}/hosts/${u}/search-queries/popular?order_by=TOTAL_SHOWS` +
    `&query_indicator=TOTAL_SHOWS&query_indicator=TOTAL_CLICKS&query_indicator=AVG_SHOW_POSITION&limit=200`;
  const data = await (await fetch(B + q, { headers: H })).json();
  const rows = (data.queries || [])
    .map((x) => ({
      q: x.query_text,
      pos: x.indicators?.AVG_SHOW_POSITION,
      shows: x.indicators?.TOTAL_SHOWS ?? 0,
      clicks: x.indicators?.TOTAL_CLICKS ?? 0,
    }))
    .filter((r) => r.pos != null)
    .sort((a, b) => a.pos - b.pos);

  // здоровье сайта: ИКС, индексация, ссылки, диагностика
  const [sum, diag, extCount, events, broken] = await Promise.all([
    summary(), diagnostics(), externalLinksCount(),
    searchEvents({ dateFrom: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), dateTo: new Date().toISOString().slice(0, 10) }),
    brokenInternalLinks({ limit: 50 }),
  ]);
  const searchable = sum?.searchable ?? null;

  // Метрика: трафик, поведение, конверсии
  let mt = null, msrc = [], mland = [], mph = [];
  if (metrikaReady()) {
    try { [mt, msrc, mland, mph] = await Promise.all([
      metrikaTotals({ days: 7 }), metrikaSources({ days: 7 }), metrikaLanding({ days: 7, limit: 6 }), metrikaPhrases({ days: 30, limit: 8 }),
    ]); } catch {}
  }
  const orgV = msrc.find((s) => /Search engine|Поиск|organic/i.test(s.source))?.visits ?? 0;

  // дельта позиций vs прошлый раз
  const prev = existsSync(HIST) ? JSON.parse(readFileSync(HIST, 'utf-8')) : {};
  const prevMap = Object.fromEntries((prev.rows || []).map((r) => [r.q, r.pos]));
  const arrow = (r) => {
    const p = prevMap[r.q];
    if (p == null) return ' 🆕';
    const d = Math.round(p) - Math.round(r.pos);
    if (d > 0) return ` ▲${d}`;
    if (d < 0) return ` ▼${-d}`;
    return ' =';
  };

  const inTop = (n) => rows.filter((r) => r.pos <= n).length;
  const top100 = rows.filter((r) => r.pos <= 100);
  const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
  const totalShows = rows.reduce((s, r) => s + r.shows, 0);

  const list = top100.slice(0, 20).map((r) =>
    `<b>${Math.round(r.pos)}</b>${arrow(r)} · ${escapeHtml(r.q)} <i>(${r.shows}п${r.clicks ? '/' + r.clicks + 'к' : ''})</i>`
  ).join('\n');

  const msg = [
    '📊 <b>Позиции в Яндексе — недельная сводка</b>',
    String(CONFIG.siteUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    '',
    `В топ-100: <b>${top100.length}</b> · топ-30: ${inTop(30)} · топ-10: ${inTop(10)} · топ-3: ${inTop(3)}`,
    `Показы: ${totalShows} · клики: ${totalClicks}`,
    '',
    '🩺 <b>Здоровье сайта</b>',
    sum ? `ИКС: <b>${sum.sqi}</b> · в поиске: ${searchable} · исключено: ${sum.excluded}` : '',
    events?.removedRecently ? `⚠️ выпало из поиска: ${events.removed}` : '',
    broken?.count ? `🔗 битых внутренних ссылок: ${broken.count}` : '',
    extCount ? `🌐 внешних ссылок: ${extCount}` : '',
    diag.length ? '🩺 проблемы: ' + escapeHtml(diag.map((d) => diagLabel(d.key)).join(', ')) : '✅ критичных проблем нет',
    '',
    mt ? '📈 <b>Трафик и конверсии (7 дней)</b>' : '',
    mt ? `Визиты: <b>${mt.visits}</b> (органика ${orgV}) · отказы ${Math.round(mt.bounce)}% · заявки: <b>${mt.conversions ?? '—'}</b>` : '',
    mland.length ? 'Топ страниц: ' + escapeHtml(mland.slice(0, 4).map((p) => `${p.path} (${p.visits})`).join(', ')) : '',
    mph.length ? '🔎 фразы захода: ' + escapeHtml(mph.slice(0, 6).map((p) => p.phrase).join('; ')) : '',
    mt ? '' : '',
    top100.length ? list : 'Пока нет запросов в выдаче — данные появятся по мере индексации.',
    top100.length > 20 ? `\n…и ещё ${top100.length - 20}` : '',
    '\n▲ рост позиции · ▼ падение · 🆕 новый (с прошлой недели)',
  ].filter(Boolean).join('\n');

  console.log(msg.replace(/<\/?[bi]>/g, ''));
  if (readiness().telegram) { try { await sendMessage(msg); } catch (e) { console.log('tg:', e.message); } }

  mkdirSync(resolve(ROOT_DIR, 'scripts/seo-agent/data'), { recursive: true });
  writeFileSync(HIST, JSON.stringify({ date: new Date().toISOString(), rows }, null, 1), 'utf-8');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
