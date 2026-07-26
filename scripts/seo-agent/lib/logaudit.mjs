// Лог-аудит доступа (crawl-аналитика): тянет access-логи сайта по FTP (reg.ru отдаёт сырые
// COMBINED-логи в /logs/<domain>.access.log[.N.gz]) и считает, КАК сайт видят боты — краулинг-бюджет
// поисковиков, присутствие ИИ-краулеров (ключевой GEO-сигнал), битые URL глазами ботов.
// Плюс — self-contained HTML-дашборд через goaccess (--log-format=COMBINED), если бинарь установлен.
//
// profile.logs = { host, user, pass, dir='logs', files:['domain.ru.access.log', ...],
//                  includeGz=true }  // gz-ротация подхватывается автоматически по префиксу файла
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';

// Combined Log Format: ip - - [date] "METHOD path proto" status bytes "ref" "ua"
const RX = /^(\S+) \S+ \S+ \[([^\]]+)\] "([A-Z]+) ([^"]*?)(?: [^"]*)?" (\d{3}) (\d+|-) "[^"]*" "([^"]*)"/;

// ИИ-краулеры (GEO): реально ли нейросети ходят по сайту
const AI_BOTS = [
  ['GPTBot', /GPTBot/i], ['OAI-SearchBot', /OAI-SearchBot|ChatGPT-User/i], ['ClaudeBot', /ClaudeBot|anthropic-ai|Claude-Web/i],
  ['PerplexityBot', /PerplexityBot|Perplexity-User/i], ['Google-Extended', /Google-Extended/i],
  ['YandexAdditional', /YandexAdditional/i], ['Amazonbot', /Amazonbot/i], ['Bytespider', /Bytespider/i], ['Applebot', /Applebot-Extended|Applebot/i],
];
// Поисковые боты (классическое SEO)
const SE_BOTS = [
  ['YandexBot', /YandexBot/i], ['Googlebot', /Googlebot(?!-Image)/i], ['Googlebot-Image', /Googlebot-Image/i],
  ['Bingbot', /bingbot/i], ['Mail.RU', /Mail\.RU_Bot/i], ['DuckDuckBot', /DuckDuckBot/i],
];
// «Мусорные»/SEO-скрейперы — жрут бюджет, пользы нет
const JUNK_BOTS = [['AhrefsBot', /AhrefsBot/i], ['SemrushBot', /SemrushBot/i], ['DotBot', /DotBot/i], ['MJ12bot', /MJ12bot/i], ['DataForSeoBot', /DataForSeoBot/i]];
const ALL_BOTS = [...SE_BOTS, ...AI_BOTS, ...JUNK_BOTS];
const RX_ANY_BOT = /(bot|crawler|spider|slurp|GPT|Claude|Perplexity|anthropic|Bytespider|Applebot)/i;

const monMap = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function parseTs(s) { // 25/Jul/2026:01:28:06 +0300
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(+m[3], monMap[m[2]] ?? 0, +m[1], +m[4], +m[5], +m[6]));
}

/** Разбор COMBINED-лога → crawl-сводка. @param {string} text */
export function parseAccessLog(text) {
  const lines = text.split('\n');
  const bots = {}; // name -> {hits, urls:Set, statuses:{}, last:Date}
  const ensure = (n) => (bots[n] ||= { hits: 0, urls: new Set(), statuses: {}, last: null, errors: {} });
  let total = 0, botHits = 0, humanHits = 0;
  const humanIps = new Set();
  let parsed = 0;

  for (const ln of lines) {
    if (!ln) continue;
    const m = RX.exec(ln);
    if (!m) continue;
    parsed++;
    const [, ip, dts, , path, status] = m;
    const ua = m[7] || '';
    total++;
    const ts = parseTs(dts);
    let matched = null;
    for (const [name, rx] of ALL_BOTS) { if (rx.test(ua)) { matched = name; break; } }
    if (!matched && RX_ANY_BOT.test(ua)) matched = 'Прочие боты';
    if (matched) {
      botHits++;
      const b = ensure(matched);
      b.hits++; b.urls.add(path.split('?')[0]);
      b.statuses[status[0] + 'xx'] = (b.statuses[status[0] + 'xx'] || 0) + 1;
      if (status[0] === '4' || status[0] === '5') b.errors[path.split('?')[0]] = (b.errors[path.split('?')[0]] || 0) + 1;
      if (ts && (!b.last || ts > b.last)) b.last = ts;
    } else if (ua && ua !== '-') { humanHits++; humanIps.add(ip); }
  }

  const pick = (defs) => defs.map(([n]) => n).filter((n) => bots[n]).map((n) => ({
    name: n, hits: bots[n].hits, urls: bots[n].urls.size,
    last: bots[n].last ? bots[n].last.toISOString().slice(0, 10) : null,
    statuses: bots[n].statuses,
    topErrors: Object.entries(bots[n].errors).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([u, c]) => ({ url: u, c })),
  }));

  const se = pick(SE_BOTS), ai = pick(AI_BOTS), junk = pick(JUNK_BOTS);
  const aiActive = ai.filter((b) => b.hits > 0);
  // битые URL, которые видят ЛЮБЫЕ боты (потери краулинг-бюджета)
  const botErrAgg = {};
  for (const [, b] of Object.entries(bots)) for (const [u, c] of Object.entries(b.errors)) botErrAgg[u] = (botErrAgg[u] || 0) + c;
  const botErrors = Object.entries(botErrAgg).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([url, c]) => ({ url, c }));

  return {
    parsedLines: parsed, totalRequests: total, botHits, humanHits, humanIps: humanIps.size,
    botShare: total ? Math.round((botHits / total) * 100) : 0,
    searchBots: se, aiBots: ai, junkBots: junk,
    aiVisible: aiActive.length > 0, aiActiveCount: aiActive.length,
    botErrors,
    findings: buildFindings(se, ai, junk, botErrors),
  };
}

function buildFindings(se, ai, junk, botErrors) {
  const f = [];
  const yandex = se.find((b) => b.name === 'YandexBot');
  if (!yandex || yandex.hits === 0) f.push({ sev: 'critical', msg: 'YandexBot не заходил в этом окне логов — сайт не краулится Яндексом' });
  if (!ai.some((b) => b.hits > 0)) f.push({ sev: 'high', msg: 'Ни один ИИ-краулер (GPTBot/ClaudeBot/PerplexityBot/Google-Extended) не зашёл — сайт невидим для нейросетей (GEO-провал)' });
  const junkHits = junk.reduce((s, b) => s + b.hits, 0);
  if (junkHits > 200) f.push({ sev: 'medium', msg: `SEO-скрейперы (Ahrefs/Semrush/…) — ${junkHits} хитов, жрут краулинг-бюджет; можно закрыть в robots.txt` });
  if (botErrors.length) { const worst = botErrors.slice(0, 3).map((e) => e.url).join(', '); f.push({ sev: 'medium', msg: `Боты упираются в ошибки (4xx/5xx): ${worst} — потери бюджета/сигналов` }); }
  return f;
}

/** Тянет логи сайта по FTP (живой + gz-ротация), возвращает единый текст. */
export async function fetchLogs(logs, { maxGz = 3 } = {}) {
  if (!logs?.host) throw new Error('profile.logs не настроен (host/user/pass/files)');
  const { Client } = await import('basic-ftp');
  const client = new Client(30000);
  const dir = (logs.dir || 'logs').replace(/\/$/, '');
  let out = '';
  try {
    await client.access({ host: logs.host, user: logs.user, password: logs.pass, secure: false });
    const listing = await client.list(dir).catch(() => []);
    for (const base of logs.files || []) {
      // живой лог
      const live = listing.find((e) => e.name === base);
      if (live) out += await readEntry(client, `${dir}/${base}`, false) + '\n';
      // gz-ротация base.access.log.1.gz .. .N.gz (свежие)
      if (logs.includeGz !== false) {
        const gz = listing.filter((e) => e.name.startsWith(base + '.') && e.name.endsWith('.gz'))
          .sort((a, b) => (a.name.length - b.name.length) || a.name.localeCompare(b.name)).slice(0, maxGz);
        for (const g of gz) out += await readEntry(client, `${dir}/${g.name}`, true) + '\n';
      }
    }
  } finally { client.close(); }
  if (!out.trim()) throw new Error('логи пусты или не найдены (проверь files/dir в profile.logs)');
  return out;
}

async function readEntry(client, remote, isGz) {
  const { PassThrough } = await import('node:stream');
  const chunks = [];
  const ps = new PassThrough();
  ps.on('data', (c) => chunks.push(c));
  await client.downloadTo(ps, remote);
  const buf = Buffer.concat(chunks);
  return (isGz ? gunzipSync(buf) : buf).toString('utf-8');
}

/** goaccess → self-contained HTML (если бинарь есть). @returns {string|null} HTML */
export function goaccessHtml(logText, title = 'Crawl-аналитика') {
  const dir = mkdtempSync(join(tmpdir(), 'ga-'));
  const inp = join(dir, 'access.log'); const out = join(dir, 'report.html');
  writeFileSync(inp, logText, 'utf-8');
  try {
    execFileSync('goaccess', [inp, '-o', out, '--log-format=COMBINED', '--html-report-title=' + title,
      '--no-query-string', '--anonymize-ip'], { stdio: 'pipe', timeout: 60000 });
    return readFileSync(out, 'utf-8');
  } catch { return null; } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
}

export function goaccessAvailable() {
  try { execFileSync('goaccess', ['--version'], { stdio: 'pipe' }); return true; } catch { return false; }
}

/** Полный crawl-аудит сайта: FTP → парс + goaccess HTML. */
export async function crawlAudit(profile) {
  const text = await fetchLogs(profile.logs);
  const summary = parseAccessLog(text);
  const html = goaccessHtml(text, `${profile.logs.files?.[0] || 'сайт'} — crawl`);
  return { summary, html, hasHtml: !!html };
}

/** Короткая текстовая сводка для ТГ-бота/агента. */
export function fmtCrawl(s) {
  const line = (b) => `${b.name}: ${b.hits} (${b.urls} URL${b.last ? ', посл. ' + b.last : ''})`;
  const L = [];
  L.push(`🕷 <b>Crawl-аналитика</b> · ${s.totalRequests} запросов, боты ${s.botShare}%`);
  L.push('');
  L.push('<b>Поисковики:</b>');
  L.push(s.searchBots.length ? s.searchBots.map(line).map((x) => '  ' + x).join('\n') : '  — никого нет');
  L.push('<b>ИИ-краулеры (GEO):</b>');
  const aiActive = s.aiBots.filter((b) => b.hits > 0);
  L.push(aiActive.length ? aiActive.map(line).map((x) => '  ' + x).join('\n') : '  ⚠️ ни одна нейросеть не заходила');
  if (s.junkBots.some((b) => b.hits)) L.push('<b>Скрейперы:</b> ' + s.junkBots.filter((b) => b.hits).map((b) => `${b.name} ${b.hits}`).join(', '));
  if (s.findings.length) { L.push(''); L.push('<b>Вывод:</b>'); for (const f of s.findings) L.push(`  ${f.sev === 'critical' ? '🛑' : f.sev === 'high' ? '⚠️' : '🔸'} ${f.msg}`); }
  return L.join('\n');
}
