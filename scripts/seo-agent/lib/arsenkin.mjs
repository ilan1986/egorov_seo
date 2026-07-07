// Arsenkin Tools API: LSI-подсветки, Wordstat-частотность, PAA-вопросы,
// релевантные URL (каннибализация), ТЗ на копирайтинг. Схема: set → check → get.
import { CONFIG } from '../config.mjs';
import { logCall } from './cost-ledger.mjs';

const { key, region } = CONFIG.arsenkin;
const BASE = 'https://arsenkin.ru/api/tools';
const H = () => ({ Authorization: `Bearer ${key}`, 'Content-type': 'application/json' });

export const arsenkinReady = () => Boolean(key);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, body, { retries = 4 } = {}) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(`${BASE}/${method}`, { method: 'POST', headers: H(), body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    if (res.status === 429) { await sleep(22000); continue; } // лимит 30/мин — ждём окно
    const data = await res.json().catch(() => null);
    if (!data) throw new Error(`arsenkin ${method}: пустой ответ`);
    return data;
  }
  throw new Error(`arsenkin ${method}: 429 после ${retries} попыток`);
}

/**
 * Поставить задачу и дождаться результата.
 * @returns result-объект инструмента или null (таймаут/ошибка).
 */
export async function runTask(tools_name, data, { maxWaitMs = 150000, pollMs = 8000 } = {}) {
  if (!arsenkinReady()) return null;
  logCall(`arsenkin-${tools_name}`); // Arsenkin — подписка, баланс через API не публикует; считаем запросы
  let set;
  try { set = await call('set', { tools_name, data }); }
  catch (e) { throw e; }
  const taskId = set?.task_id;
  if (!taskId) throw new Error(`arsenkin set(${tools_name}): ${set?.code || 'нет task_id'} ${set?.msg || ''}`);

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    let ch;
    try { ch = await call('check', { task_id: taskId }); } catch { continue; }
    if (ch?.status === 'finish' || ch?.progress === 100) break;
    if (ch?.status === 'error' || ch?.code === 'TASK_ERROR') throw new Error(`arsenkin ${tools_name} error`);
  }
  const got = await call('get', { task_id: taskId });
  return got?.result ?? null;
}

// ── LSI-подсветки (топ-10): термины, которые Яндекс выделяет жирным ──
/** Возвращает {lsi:[{word,count}], query:[...], forms:[...]} по запросу. */
export async function lsiTerms(query, { depth = 10, se = 1 } = {}) {
  const r = await runTask('sp', { queries: [query], se, region, depth });
  if (!r) return { lsi: [], query: [], forms: [] };
  const toArr = (obj) => Object.entries(obj || {}).map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count);
  return {
    lsi: toArr(r.LSI),
    query: Object.keys(r.queryWords || {}),
    forms: toArr({ ...(r.hlWords?.normal || {}), ...(r.hlWords?.lemma || {}) }).map((x) => x.word),
  };
}

// ── Wordstat: базовая и точная частотность ──
/** [{phrase, base, quoted, exact}] — общая и уточнённая частота по региону. */
export async function wordstat(queries, { regions } = {}) {
  const reg = regions || [region];
  const r = await runTask('wordstat', { type: 1, queries, device: '', regions: reg, ws: ['base', 'quoted', 'exact'] });
  const res = r?.data?.result || r?.result || {};
  return queries.map((q) => {
    const byReg = res[q] || {};
    const v = byReg[String(reg[0])] || Object.values(byReg)[0] || {};
    return { phrase: q, base: v.base ?? null, quoted: v.quoted ?? null, exact: v.exact ?? null };
  });
}

// ── PAA: вопросы People Also Ask ──
/** [{question, answer}] по запросу (для авто-FAQ). */
export async function paaQuestions(query, { se = 1, count = 10 } = {}) {
  const r = await runTask('paa', { queries: [query], se, region, depth: 1, count });
  const arr = r?.result?.[0] || [];
  return arr.map((x) => ({ question: x.question, answer: (x.answer || '').replace(/<[^>]+>/g, '').trim() }))
    .filter((x) => x.question);
}

// ── Релевантные URL: какую нашу страницу Яндекс считает релевантной (каннибализация) ──
/** [{query, url}] по запросам для нашего хоста (пусто, если хост не в выдаче). */
export async function relevantUrls(queries, host, { se = 1 } = {}) {
  const r = await runTask('relevant-url', { queries, host, se, region });
  const res = r?.result || r?.data?.result || [];
  const rows = Array.isArray(res) ? res : Object.entries(res).map(([key, url]) => ({ key, url }));
  return rows.map((x) => ({ query: x.key || x.query, url: x.url })).filter((x) => x.url);
}

// ── ТЗ на копирайтинг: объём/термины/структура из топа ──
export async function copyBrief(queries, { se = 1 } = {}) {
  const r = await runTask('copyrighters', { foreign: false, remove_main: true, se, region, queries });
  return r;
}
