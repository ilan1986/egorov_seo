// Низкоуровневые помощники MAX Bot API (botapi.max.ru). См. память reference_max_bot_api.
import { CONFIG } from '../seo-agent/config.mjs';

const TOKEN = CONFIG.max?.botToken;
const API = 'https://botapi.max.ru';

function headers() {
  return { Authorization: TOKEN, 'Content-Type': 'application/json' };
}

/** Список чатов бота — используется, чтобы найти chat_id (юзер должен один раз написать боту сам). */
export async function maxListChats() {
  if (!TOKEN) return [];
  try {
    const res = await fetch(`${API}/chats`, { headers: headers() });
    const data = await res.json();
    return data.chats ?? [];
  } catch {
    return [];
  }
}

/** Отправить текст во ВСЕ известные чаты бота (обычно один — личка владельца, если он писал боту). */
export async function maxSendToAllChats(text) {
  if (!TOKEN) return false;
  const chats = await maxListChats();
  if (!chats.length) return false;
  let ok = false;
  for (const chat of chats) {
    try {
      const res = await fetch(`${API}/messages?chat_id=${chat.chat_id}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ text }),
      });
      if (res.ok) ok = true;
    } catch {
      /* пропуск чата с ошибкой */
    }
  }
  return ok;
}

export const maxReady = () => Boolean(TOKEN);
