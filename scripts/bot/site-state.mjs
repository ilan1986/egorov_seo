// Живое состояние сайта для диалогового бота: реальные данные агента (позиции, свежие
// страницы, объём, расходы) — чтобы бот отвечал фактами, а не выдумками.
// Все источники — файлы, которые пишет сам SEO-агент в scripts/seo-agent/data.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG, ROOT_DIR } from '../seo-agent/config.mjs';
import { PROFILE } from '../../site.profile.mjs';

const DATA = join(ROOT_DIR, 'scripts/seo-agent/data');
const readJson = (p, def) => {
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return def; }
};
const round1 = (n) => Math.round(n * 10) / 10;
const DAY = 864e5;

// Свежеопубликованные страницы (URL → ISO-дата отправки на переобход)
export function recentPages(days = 7) {
  const rec = readJson(join(DATA, 'recrawl-submitted.json'), {});
  const since = Date.now() - days * DAY;
  return Object.entries(rec)
    .map(([url, ts]) => ({ url, ts, t: new Date(ts).getTime() }))
    .filter((x) => Number.isFinite(x.t) && x.t >= since)
    .sort((a, b) => b.t - a.t);
}

// Позиции в Яндексе: [{q, p}] отсортированы по позиции (лучшие сверху)
export function positions() {
  const st = readJson(join(DATA, 'report-state.json'), {});
  const pos = st.positions || {};
  return Object.entries(pos)
    .map(([q, p]) => ({ q, p: round1(Number(p)) }))
    .filter((x) => Number.isFinite(x.p))
    .sort((a, b) => a.p - b.p);
}

// Кол-во готовых страниц в собранном сайте (index.html в dist)
export function totalPages() {
  const dist = join(ROOT_DIR, 'dist');
  let n = 0;
  const walk = (d) => {
    let ents;
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name === 'index.html') n++;
    }
  };
  walk(dist);
  return n;
}

// Расходы ИИ (usd) по дневным файлам costs/YYYY-MM-DD.json
export function costs(days = 7) {
  const dir = join(DATA, 'costs');
  const todayStr = new Date().toISOString().slice(0, 10);
  let total = 0, today = 0;
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return { total: 0, today: 0 }; }
  const since = Date.now() - days * DAY;
  for (const f of files) {
    const day = f.slice(0, 10);
    const c = readJson(join(dir, f), {});
    const usd = c.usd || {};
    const sum = Object.values(usd).reduce((a, b) => a + (Number(b) || 0), 0);
    if (new Date(day).getTime() >= since) total += sum;
    if (day === todayStr) today += sum;
  }
  return { total: round1(total * 100) / 100, today: round1(today * 100) / 100 };
}

// Компактный блок «текущее состояние» для инъекции в системный промпт диалога.
export function buildSiteState() {
  const pos = positions();
  const top10 = pos.filter((x) => x.p <= 10);
  const top20 = pos.filter((x) => x.p > 10 && x.p <= 20);
  const pages = recentPages(7);
  const c = costs(7);
  const now = new Date().toISOString().slice(0, 10);
  const L = [];
  L.push(`Дата: ${now}. Сайт ${PROFILE.bot.projectName} (${CONFIG.siteUrl}) — ЖИВОЙ, в индексе, принимает заявки.`);
  const tp = totalPages();
  if (tp > 0) L.push(`Всего страниц на сайте: ${tp}.`);
  if (pos.length) {
    L.push(`Позиции в Яндексе (Вебмастер): в ТОП-10 — ${top10.length} запросов, в ТОП-11–20 — ${top20.length} (всего отслеживается ${pos.length}).`);
    if (top10.length) L.push(`ТОП-10: ${top10.slice(0, 15).map((x) => `«${x.q}» — ${x.p}`).join('; ')}.`);
  } else {
    L.push('Позиции: данные Вебмастера ещё не собраны.');
  }
  L.push(`Отправлено на индексацию в Яндекс за 7 дней: ${pages.length} страниц (это переобход, часть — массовая переотправка, а не только новые).`);
  if (pages.length) L.push(`Последние URL: ${pages.slice(0, 12).map((p) => p.url).join(', ')}.`);
  L.push(`Расходы ИИ: сегодня $${c.today.toFixed(2)}, за 7 дней $${c.total.toFixed(2)}.`);
  L.push('Используй эти данные как факты. Если чего-то здесь нет — так и скажи, не выдумывай цифры/страницы/контакты.');
  return L.join('\n');
}

// ── Форматирование для команд ────────────────────────
export function fmtPages(days = 7, limit = 25) {
  const pages = recentPages(days);
  if (!pages.length) return `За последние ${days} дн. новых страниц не публиковалось.`;
  const head = `📄 <b>Отправлено на индексацию за ${days} дн.: ${pages.length}</b>\n<i>(переобход Яндекса; часть — массовая переотправка)</i>\n`;
  const rows = pages.slice(0, limit).map((p) => {
    const d = new Date(p.ts).toISOString().slice(0, 10);
    return `• ${d} — ${p.url}`;
  });
  const more = pages.length > limit ? `\n…и ещё ${pages.length - limit}.` : '';
  return head + rows.join('\n') + more;
}

export function fmtPositions(limit = 40) {
  const pos = positions();
  if (!pos.length) return 'Данных о позициях пока нет (Вебмастер не отдал статистику).';
  const top10 = pos.filter((x) => x.p <= 10);
  const top20 = pos.filter((x) => x.p > 10 && x.p <= 20);
  const L = [`📊 <b>Позиции в Яндексе</b> — ТОП-10: ${top10.length}, ТОП-11–20: ${top20.length}, всего: ${pos.length}`, ''];
  L.push('<b>В ТОП-10:</b>');
  L.push(top10.length ? top10.slice(0, limit).map((x) => `• «${x.q}» — ${x.p}`).join('\n') : '— пока нет');
  if (top20.length) {
    L.push('', '<b>Близко (11–20):</b>');
    L.push(top20.slice(0, 15).map((x) => `• «${x.q}» — ${x.p}`).join('\n'));
  }
  return L.join('\n');
}

export function fmtReport() {
  const pos = positions();
  const top10 = pos.filter((x) => x.p <= 10).length;
  const top20 = pos.filter((x) => x.p > 10 && x.p <= 20).length;
  const week = recentPages(7).length;
  const c = costs(7);
  return [
    `🧭 <b>Сводка по сайту ${escapeName(PROFILE.bot.projectName)}</b>`,
    `Страниц всего: ${totalPages()}`,
    `Опубликовано за 7 дн.: ${week}`,
    `Позиции: ТОП-10 — ${top10}, ТОП-11–20 — ${top20} (из ${pos.length})`,
    `Расходы ИИ: сегодня $${c.today.toFixed(2)}, за 7 дн. $${c.total.toFixed(2)}`,
    '',
    'Подробнее: /positions — позиции, /pages — свежие страницы.',
  ].join('\n');
}

function escapeName(s) { return String(s).replace(/[<>&]/g, ''); }
