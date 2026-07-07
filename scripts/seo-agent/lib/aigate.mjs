// Клиент AiGate (OpenAI-совместимый) для генерации контента и диалога бота.
import { CONFIG, DEFAULT_HEADERS } from '../config.mjs';
import { logCostUsd } from './cost-ledger.mjs';

const { baseUrl, key, model } = CONFIG.aigate;

/**
 * Chat completion. messages: [{role, content}].
 * Возвращает строку ответа.
 * costCategory: 'generation' (по умолч.) | 'dialog' — тег для дневного отчёта расходов
 * (aigate отдаёт usage.cost_usd в каждом ответе — реальная цена вызова, не оценка).
 */
export async function chat(messages, { temperature = 0.7, maxTokens = 4096, modelOverride, timeoutMs = 120_000, costCategory = 'generation' } = {}) {
  if (!key) throw new Error('aigate: не задан AIGATE_API_KEY');
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      ...DEFAULT_HEADERS,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: modelOverride || model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
    // без таймаута зависший запрос к aigate.shop вешает весь прогон агента навсегда (нет cron-уровня recovery)
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`aigate HTTP ${res.status}: ${text.slice(0, 300)}`);
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`aigate: не JSON: ${text.slice(0, 200)}`); }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error(`aigate: пустой ответ: ${text.slice(0, 200)}`);
  if (typeof data?.usage?.cost_usd === 'number') logCostUsd(`aigate-${costCategory}`, data.usage.cost_usd);
  return content;
}

/** Удобный помощник: системный + пользовательский промпт → текст. */
export function ask(system, user, opts = {}) {
  return chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    opts
  );
}
