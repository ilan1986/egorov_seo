// Низкоуровневые помощники Telegram Bot API.
import { CONFIG } from '../seo-agent/config.mjs';

const TOKEN = CONFIG.telegram.token;
const API = `https://api.telegram.org/bot${TOKEN}`;

function assertToken() {
  if (!TOKEN) throw new Error('telegram: не задан TELEGRAM_BOT_TOKEN');
}

async function call(method, payload) {
  assertToken();
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`telegram ${method}: ${data.description || res.status}`);
  return data.result;
}

export function getMe() {
  return call('getMe', {});
}

/** Отправить сообщение. По умолчанию — в основной chatId из .env. */
export function sendMessage(text, { chatId = CONFIG.telegram.chatId, parseMode = 'HTML', ...opts } = {}) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: true,
    ...opts,
  });
}

export function sendChatAction(chatId, action = 'typing') {
  return call('sendChatAction', { chat_id: chatId, action }).catch(() => {});
}

/** Long polling. */
export function getUpdates(offset, timeout = 30) {
  return call('getUpdates', { offset, timeout, allowed_updates: ['message'] });
}

export const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Отправить структурное Rich-сообщение (Bot API 10.1: заголовки/таблицы/абзацы).
 * Возвращает true при успехе, false при любой ошибке — вызывающий тогда шлёт текстовый фолбэк.
 * НЕ бросает исключений (в отличие от call()).
 */
export async function sendRichMessage(blocks, { chatId = CONFIG.telegram.chatId } = {}) {
  assertToken();
  if (!Array.isArray(blocks) || !blocks.length) return false;
  try {
    const res = await fetch(`${API}/sendRichMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, rich_message: { blocks } }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json();
    return Boolean(data && data.ok);
  } catch {
    return false;
  }
}
