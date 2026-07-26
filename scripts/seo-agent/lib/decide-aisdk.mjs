// Выбор действия через Vercel AI SDK tool-calling: модель ОБЯЗАНА вызвать ровно один инструмент
// из реестра (схема Zod), а не вернуть свободный текст. Это структурно устраняет парс-сбои JSON и
// галлюцинацию инструментов (нельзя вызвать то, чего нет). Провайдер — AiGate (OpenAI-совместимый).
// Требует: ai, @ai-sdk/openai-compatible, zod + env AIGATE_API_KEY. Модель — claude-sonnet (tool-calling).
import { generateText, tool } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { TOOLS, allowedToolNames } from './agent-tools.mjs';

const MODEL = process.env.AGENT_MODEL || 'anthropic/claude-sonnet-4.6';
const BASE = process.env.AIGATE_BASE_URL || 'https://api.aigate.shop/v1';

/**
 * @param {string} system @param {string} user @param {{caps?:string[]|null}} opts
 * @returns {Promise<{action:string, args:object, why:string}>}
 */
export async function decideAiSdk(system, user, { caps = null } = {}) {
  if (!process.env.AIGATE_API_KEY) throw new Error('нет AIGATE_API_KEY');
  const provider = createOpenAICompatible({ name: 'aigate', baseURL: BASE, apiKey: process.env.AIGATE_API_KEY });
  const model = provider(MODEL);

  const tools = {};
  for (const name of allowedToolNames(caps)) {
    const t = TOOLS[name];
    const shape = { why: z.string().describe('обоснование выбора по данным состояния') };
    if (t.args) for (const k of Object.keys(t.args)) shape[k] = z.string().optional().describe(String(t.args[k] || k));
    tools[name] = tool({ description: `[${t.risk}] ${t.desc}`, inputSchema: z.object(shape), execute: async (a) => a });
  }
  tools.stop = tool({ description: 'ценных действий в рамках бюджета не осталось — остановиться', inputSchema: z.object({ why: z.string() }), execute: async (a) => a });

  const common = { model, system, prompt: user, tools, temperature: 0.3, maxOutputTokens: 600 };
  let res;
  try { res = await generateText({ ...common, toolChoice: 'required' }); }
  catch { res = await generateText({ ...common, system: system + ' Обязательно вызови ровно ОДИН инструмент.', toolChoice: 'auto' }); }

  const call = (res.toolCalls || [])[0];
  if (!call) return { action: 'stop', why: 'модель не вызвала инструмент' };
  const args = call.input || call.args || {};
  return { action: call.toolName, args, why: args.why || '' };
}

export function aiSdkAvailable() {
  try { return !!(generateText && createOpenAICompatible && process.env.AIGATE_API_KEY); } catch { return false; }
}
