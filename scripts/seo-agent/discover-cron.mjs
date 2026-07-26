// Еженедельный авто-discover: проходит по нишам, добавляет новых кандидатов в воронку, шлёт сводку
// в Telegram (агентский пульт). Запуск по cron. Ниши и лимит — из ENV или дефолт.
// Telegram-креды берём из /opt/ilyaegorov/.env (бот агентского пульта).
import { readFileSync } from 'node:fs';
import { discover, fmtDiscover } from './discover.mjs';

const NICHES = (process.env.DISCOVER_NICHES || 'стоматология,интернет-магазин').split(',').map((s) => s.trim()).filter(Boolean);
const LIMIT = Number(process.env.DISCOVER_LIMIT || 8);

function tgCreds() {
  try {
    const env = {};
    for (const ln of readFileSync('/opt/ilyaegorov/.env', 'utf-8').split('\n')) {
      const s = ln.trim(); if (!s || s.startsWith('#') || !s.includes('=')) continue;
      const i = s.indexOf('='); env[s.slice(0, i).trim()] = s.slice(i + 1).trim();
    }
    return { token: env.TELEGRAM_BOT_TOKEN, chat: env.TELEGRAM_CHAT_ID };
  } catch { return {}; }
}
async function notify(text) {
  const { token, chat } = tgCreds();
  if (!token || !chat) { console.log('[discover-cron] нет TG-кредов'); return; }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (e) { console.log('[discover-cron] tg err', e.message); }
}

async function main() {
  const parts = [];
  for (const niche of NICHES) {
    try {
      const r = await discover(niche, { limit: LIMIT });
      console.log(`[discover-cron] ${niche}: +${r.added}`);
      if (r.added) parts.push(fmtDiscover(r, niche));
    } catch (e) { console.log(`[discover-cron] ${niche} err`, e.message); }
  }
  if (parts.length) await notify(`🗓 <b>Еженедельный подбор клиентов</b>\n\n${parts.join('\n\n———\n\n')}`);
  else await notify('🗓 Еженедельный подбор: новых кандидатов не найдено (база исчерпана — обнови 2ГИС-выгрузку).');
}
main().catch((e) => { console.error(e.message); process.exit(1); });
