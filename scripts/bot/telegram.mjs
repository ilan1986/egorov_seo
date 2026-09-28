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

/** Зарегистрировать список команд — они появляются в синей кнопке «Меню» клиента Telegram.
 * commands: [{command, description}]. Без этого меню бота пустое (команды работают, но их не видно). */
export function setMyCommands(commands) {
  return call('setMyCommands', { commands }).catch((e) => { console.error('[bot] setMyCommands:', e.message); });
}

/** Отправить сообщение. По умолчанию — в основной chatId из .env. */
export function sendMessage(text, { chatId = CONFIG.telegram.chatId, parseMode = 'HTML', ...opts } = {}) {
  const _tag = CONFIG.telegram.siteTag;
  return call('sendMessage', {
    chat_id: chatId,
    text: _tag ? `[${_tag}] ${text}` : text,
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
