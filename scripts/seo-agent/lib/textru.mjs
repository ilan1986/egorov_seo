// Клиент text.ru: проверка уникальности текста.
// API: POST https://api.text.ru/post (add) → uid; POST с uid → результат.
import { CONFIG, DEFAULT_HEADERS } from '../config.mjs';

const { key, minUnique } = CONFIG.textru;
const API = 'https://api.text.ru/post';

function assertKey() {
  if (!key) throw new Error('text.ru: не задан TEXTRU_KEY (полный 32-символьный user_key)');
}

async function postForm(params) {
  const body = new URLSearchParams(params);
  const res = await fetch(API, {
    method: 'POST',
    headers: { ...DEFAULT_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(`text.ru: не JSON: ${text.slice(0, 200)}`); }
}

/** Поставить текст в очередь проверки → uid. */
export async function addText(text) {
  assertKey();
  const data = await postForm({ userkey: key, text });
  if (data.error_code) throw new Error(`text.ru add error ${data.error_code}: ${data.error_desc || ''}`);
  if (!data.text_uid) throw new Error(`text.ru: нет text_uid: ${JSON.stringify(data).slice(0, 200)}`);
  return data.text_uid;
}

/** Получить результат по uid. Возвращает { unique, raw } или null, если ещё считается. */
export async function getResult(uid) {
  assertKey();
  const data = await postForm({ userkey: key, uid });
  if (data.error_code === 181) return null; // ещё в процессе
  if (data.error_code) throw new Error(`text.ru result error ${data.error_code}: ${data.error_desc || ''}`);
  const result = typeof data.text_unique !== 'undefined' ? Number(data.text_unique) : null;
  return { unique: result, raw: data };
}

/** Полный цикл: добавить и дождаться результата (с поллингом). */
export async function checkUniqueness(text, { tries = 20, delayMs = 6000 } = {}) {
  const uid = await addText(text);
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    const r = await getResult(uid);
    if (r) return { uid, unique: r.unique, pass: r.unique >= minUnique, minUnique };
  }
  throw new Error('text.ru: превышено время ожидания результата');
}
