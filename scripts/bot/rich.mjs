// Rich-отчёты Telegram (Bot API 10.1 `sendRichMessage`) + автоматический фолбэк на обычный текст
// для клиентов, которые ещё не умеют rich. Конвертирует существующий lines[] отчёта в структурные
// блоки (заголовки/таблицы) — логику самих отчётов НЕ трогаем, только красиво рендерим.
//
// Подтверждённая схема (разгадана эмпирически 26.07.2026):
//   sendRichMessage { chat_id, rich_message: { blocks: [...] } }
//   heading:   { type:'heading', size:2|3, text }   (size обязателен)
//   paragraph: { type:'paragraph', text }           (\n внутри работают)
//   table:     { type:'table', cells:[[{text},{text}], ...] }  (cells = 2D: строки→ячейки)
import { sendRichMessage, sendMessage } from './telegram.mjs';
import { CONFIG } from '../seo-agent/config.mjs';

// Относительные пути (/blog/…, /stati/…) в отчётах Telegram НЕ делает кликабельными.
// Абсолютный https-URL — авто-линкуется и в Rich (entity url), и в текстовом фолбэке.
const BASE = String(CONFIG.siteUrl || '').replace(/\/$/, '');
/** Превратить относительные URL-пути в абсолютные (по домену сайта) — чтобы ссылки были активными. */
export const absolutize = (s) =>
  BASE ? String(s).replace(/(^|[\s(])(\/[a-z0-9][\w-]*\/[\w\-/]*)/gi, (_m, pre, path) => `${pre}${BASE}${path}`) : String(s);

export const H = (text, size = 3) => ({ type: 'heading', size, text: String(text) });
export const P = (text) => ({ type: 'paragraph', text: String(text) });
export const TABLE = (rows) => ({ type: 'table', cells: rows.map((r) => r.map((c) => ({ text: String(c) }))) });

const strip = (s) => String(s).replace(/<\/?[^>]+>/g, '').trim();

/**
 * lines[] отчёта (строки, возможно с <b>/<i>) → массив rich-блоков.
 *  - первая непустая строка → крупный заголовок (size 2);
 *  - строка целиком в <b>…</b> → подзаголовок секции (size 3);
 *  - «Ключ: значение» (в т.ч. с ведущим •) → строка таблицы, соседние копятся в одну таблицу;
 *  - прочее (буллеты-мысли, тренды, заметки) → абзац, соседние копятся в один абзац;
 *  - пустая строка → разделитель секций (сброс накопителей).
 */
export function linesToBlocks(lines) {
  const blocks = [];
  let rows = null, para = null;
  const flushRows = () => { if (rows && rows.length) blocks.push(TABLE(rows)); rows = null; };
  const flushPara = () => { if (para && para.length) blocks.push(P(para.join('\n'))); para = null; };
  const flush = () => { flushRows(); flushPara(); };
  const arr = lines.filter((l) => l !== undefined && l !== null);
  let seenTitle = false;
  arr.forEach((raw) => {
    const txt = strip(raw);
    if (txt === '') { flush(); return; }
    if (!seenTitle) { seenTitle = true; flush(); blocks.push(H(txt, 2)); return; }
    if (/^<b>[^<]*<\/b>$/.test(String(raw).trim())) { flush(); blocks.push(H(txt, 3)); return; }
    const body = txt.replace(/^[•\-–]\s*/, '');
    const kv = body.match(/^([^:]{1,40}):\s+(\S.*)$/);
    if (kv && !/https?:\/\//.test(body)) { flushPara(); (rows || (rows = [])).push([kv[1].trim(), kv[2].trim()]); return; }
    flushRows(); (para || (para = [])).push(txt);
  });
  flush();
  return blocks;
}

/** Отправить отчёт из lines[]: сначала Rich, при неудаче/старом клиенте — тем же текстом. */
export async function sendReportLines(lines, { chatId } = {}) {
  const clean = lines.filter((l) => l !== undefined && l !== null).map(absolutize);
  if (!clean.length) return false;
  const opts = chatId ? { chatId } : {};
  const ok = await sendRichMessage(linesToBlocks(clean), opts);
  if (!ok) await sendMessage(clean.join('\n'), opts);
  return ok;
}
