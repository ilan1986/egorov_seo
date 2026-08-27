// Google Search Console (аналог Яндекс.Вебмастера для Google). ОПТ-ИН: работает ТОЛЬКО если заданы
// креды сервис-аккаунта + URL свойства. Пусто → gscReady()=false → Google-канал выключен, агент
// остаётся на Яндексе по умолчанию. Зависимостей нет: JWT подписываем node:crypto, токен — OAuth2.
//
// Настройка (делает владелец в Google Cloud + GSC):
//   1) Создать сервис-аккаунт, скачать JSON-ключ.
//   2) В Google Search Console → Настройки → Пользователи → добавить client_email сервис-аккаунта (роль «Полный»/«Ограниченный»).
//   3) В .env: GOOGLE_SA_JSON=<путь к json ИЛИ сам json> и GSC_SITE_URL=sc-domain:example.com  (или https://example.com/)
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function loadSA() {
  const raw = process.env.GOOGLE_SA_JSON || process.env.GSC_SA_JSON;
  if (!raw) return null;
  try { return raw.trim().startsWith('{') ? JSON.parse(raw) : JSON.parse(readFileSync(raw, 'utf-8')); } catch { return null; }
}
const SA = loadSA();
const GSC_SITE = process.env.GSC_SITE_URL || '';

/** Готов ли Google-канал (заданы креды). false → агент работает только по Яндексу. */
export function gscReady() { return !!(SA?.client_email && SA?.private_key && GSC_SITE); }

const b64url = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlBuf = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

let _tok = null, _exp = 0;
async function token() {
  if (_tok && Date.now() < _exp - 60000) return _tok;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: SA.client_email, scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const sig = createSign('RSA-SHA256').update(`${header}.${claim}`).sign(SA.private_key);
  const jwt = `${header}.${claim}.${b64urlBuf(sig)}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('GSC token: ' + JSON.stringify(j).slice(0, 160));
  _tok = j.access_token; _exp = Date.now() + (j.expires_in || 3600) * 1000;
  return _tok;
}

async function query(body) {
  const t = await token();
  const r = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE)}/searchAnalytics/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`GSC HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return r.json();
}

/** Топ-запросы Google для сайта: клики/показы/CTR/позиция. */
export async function gscTopQueries({ days = 28, limit = 25 } = {}) {
  const j = await query({ startDate: daysAgo(days), endDate: daysAgo(1), dimensions: ['query'], rowLimit: limit });
  return (j.rows || []).map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));
}

/** Спрос-гэпы Google: показы есть, позиция 11–30 (2-я страница) → кандидаты на рост. Аналог Вебмастер-DEMAND. */
export async function gscDemandGaps({ days = 28, top = 8 } = {}) {
  const rows = await gscTopQueries({ days, limit: 250 });
  return rows.filter((r) => r.impressions >= 5 && r.position > 10 && r.position <= 30)
    .sort((a, b) => b.impressions - a.impressions).slice(0, top)
    .map((r) => ({ query: r.query, demand: r.impressions, position: Math.round(r.position) }));
}

/** Страницы с показами без кликов (низкий CTR) → кандидаты на переписывание title/description под Google. */
export async function gscCtrGaps({ days = 28, top = 6 } = {}) {
  const j = await query({ startDate: daysAgo(days), endDate: daysAgo(1), dimensions: ['page'], rowLimit: 250 });
  return (j.rows || []).map((r) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }))
    .filter((r) => r.impressions >= 20 && r.ctr < 0.02 && r.position <= 20)
    .sort((a, b) => b.impressions - a.impressions).slice(0, top);
}

/** Итоги Google за период. */
export async function gscTotals({ days = 28 } = {}) {
  const j = await query({ startDate: daysAgo(days), endDate: daysAgo(1) });
  const r = (j.rows || [])[0] || {};
  return { clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.ctr || 0, position: r.position || null };
}

// CLI-проверка: node scripts/seo-agent/lib/gsc.mjs
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!gscReady()) { console.log('GSC не настроен (нет GOOGLE_SA_JSON/GSC_SITE_URL) — Google-канал выключен, агент на Яндексе.'); process.exit(0); }
  (async () => {
    const t = await gscTotals();
    console.log(`Google 28д: ${t.clicks} кликов, ${t.impressions} показов, CTR ${(t.ctr * 100).toFixed(1)}%, поз. ${t.position?.toFixed(1) ?? '—'}`);
    const gaps = await gscDemandGaps();
    console.log('Спрос-гэпы Google (2-я стр.):'); for (const g of gaps) console.log(`  ${g.position}. ${g.query} — ${g.demand} показов`);
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
