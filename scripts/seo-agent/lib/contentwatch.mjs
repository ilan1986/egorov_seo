// Клиент content-watch.ru: проверка уникальности (синхронно, дёшево ~0.50₽/проверка).
// API: POST https://content-watch.ru/public/api/ {key, action:CHECK_TEXT, text} → {error, percent}.
import { CONFIG, DEFAULT_HEADERS } from '../config.mjs';

const { key, minUnique } = CONFIG.contentwatch;
const API = 'https://content-watch.ru/public/api/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const contentwatchReady = () => Boolean(key);

async function call(params, { retries = 3 } = {}) {
  for (let i = 0; i <= retries; i++) {
    let res, txt;
    try {
      res = await fetch(API, {
        method: 'POST',
        headers: { ...DEFAULT_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
        signal: AbortSignal.timeout(60_000),
      });
      txt = await res.text();
    } catch (e) {
      if (i < retries) { await sleep(6000); continue; } // таймаут/сеть — ещё попытка
      throw e;
    }
    let data;
    try { data = JSON.parse(txt); } catch { throw new Error(`content-watch: не JSON: ${txt.slice(0, 150)}`); }
    // временные ошибки (лимит потоков/подождите) — ждём и повторяем
    if (data.error && /поток|подожд|повтор|лимит|too many|занят|попроб/i.test(data.error) && i < retries) {
      await sleep(9000);
      continue;
    }
    return data;
  }
}

/** Остаток баланса (руб). */
export async function balance() {
  const d = await call({ key, action: 'GET_BALANCE' });
  return { balance: Number(d.balance), tariff: Number(d.tariff), user: d.user };
}

/**
 * Проверить уникальность. Интерфейс совместим с textru.checkUniqueness.
 * @returns { unique, pass, minUnique } — unique = процент уникальности (0..100).
 */
export async function checkUniqueness(text, { minUnique: min = minUnique } = {}) {
  if (!key) throw new Error('content-watch: не задан CONTENTWATCH_KEY');
  const data = await call({ key, action: 'CHECK_TEXT', text: String(text).slice(0, 15000) });
  if (data.error) throw new Error(`content-watch: ${data.error}`);
  const unique = typeof data.percent !== 'undefined' ? Number(data.percent) : null;
  return { unique, pass: unique != null && unique >= min, minUnique: min };
}
