// LLM-клиент с мультипровайдерным фолбэком (OpenAI-совместимый).
// Порядок провайдеров и ключи — в config.mjs / .env. Если задан локальный llm-proxy (AIGATE_BASE_URL),
// он идёт основным (свой устойчивый фолбэк + localhost-скорость), иначе основной — closerouter;
// при сбое (502/timeout/пустой ответ) клиент по кругу пробует резервы closerouter → anymodel → wellflow.
import { CONFIG, DEFAULT_HEADERS } from '../config.mjs';
import { logCostUsd } from './cost-ledger.mjs';

const PROVIDERS = CONFIG.providers || [CONFIG.aigate];

// Один запрос к конкретному провайдеру. Бросает при не-2xx / не-JSON / пустом ответе.
async function callProvider(p, { messages, temperature, maxTokens, tier, timeoutMs }) {
  const model = tier === 'dialog' ? (p.dialogModel || p.model) : p.model;
  const res = await fetch(`${p.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      ...DEFAULT_HEADERS,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${p.key}`,
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
    // без таймаута зависший запрос вешает весь прогон агента навсегда (нет cron-recovery)
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${p.name} HTTP ${res.status}: ${text.slice(0, 200)}`);
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`${p.name}: не JSON: ${text.slice(0, 150)}`); }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error(`${p.name}: пустой ответ`);
  return { content, cost: data?.usage?.cost_usd, model };
}

/**
 * Chat completion с фолбэком по провайдерам.
 * messages: [{role, content}]. Возвращает строку ответа.
 * opts.tier: 'generation' (по умолч., Sonnet-класс) | 'dialog' (дешевле, для бота).
 * costCategory — тег для дневного отчёта расходов (cost_usd отдаёт только часть провайдеров).
 */
// Таймаут одного запроса. Провайдеры отвечают с огромным разбросом (замер на боевом сервере:
// 400 токенов — то 8 с, то 35 с), и статья на 1800+ слов в 200 с не всегда укладывается —
// запрос рвётся, материал теряется. Держим в .env, чтобы поднимать без правки ядра.
const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 200_000);

export async function chat(messages, { temperature = 0.7, maxTokens = 4096, tier, modelOverride, timeoutMs = DEFAULT_TIMEOUT_MS, costCategory = 'generation' } = {}) {
  const usable = PROVIDERS.filter((p) => p && p.key);
  if (!usable.length) throw new Error('LLM: ни один провайдер не настроен (нет ключей)');
  // modelOverride оставлен для обратной совместимости: раньше им передавали dialog-модель aigate.
  const t = tier || (modelOverride ? 'dialog' : 'generation');
  const errors = [];
  for (let i = 0; i < usable.length; i++) {
    const p = usable[i];
    try {
      const { content, cost } = await callProvider(p, { messages, temperature, maxTokens, tier: t, timeoutMs });
      if (typeof cost === 'number') logCostUsd(`${p.name}-${costCategory}`, cost);
      if (i > 0) console.warn(`[llm] основной(${usable[0].name}) недоступен → ответ через резерв: ${p.name}`);
      return content;
    } catch (e) {
      errors.push(`${p.name}: ${e.message}`);
      // переходим к следующему провайдеру по кругу
    }
  }
  throw new Error(`LLM: все провайдеры недоступны →\n  ${errors.join('\n  ')}`);
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
