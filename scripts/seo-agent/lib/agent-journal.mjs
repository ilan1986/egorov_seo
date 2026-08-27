// Память автономного агента: журнал решений, цели, эксперименты, очередь предложений на согласование.
// Всё в data/agent/. Журнал — чтобы агент учился (сработало → усиливать, нет → откатывать) и был
// прозрачен человеку. Предложения (risk=approve) уходят в Telegram и ждут /approve|/reject.
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR } from '../config.mjs';
import { PROFILE } from '../../../site.profile.mjs';

const DIR = join(ROOT_DIR, 'scripts/seo-agent/data/agent');
const JOURNAL = join(DIR, 'journal.jsonl');
const PROPOSALS = join(DIR, 'proposals.json');
const EXPERIMENTS = join(DIR, 'experiments.json');
const ensure = () => { try { mkdirSync(DIR, { recursive: true }); } catch {} };
const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return d; } };
const stamp = () => new Date().toISOString();
const rid = () => stamp().replace(/[^0-9]/g, '').slice(2, 14) + Math.floor(Math.random() * 90 + 10);

/** Цели агента из профиля (что значит «результат»). */
export function goals() {
  return PROFILE.goals || {
    primary: 'растить трафик и заявки из ДВУХ каналов: поиск (SEO) и нейросети (GEO). ГЛАВНАЯ цель — цитируемость сайта нейросетями (Алиса, GPT, Gemini): нейронки цитируют тех, кто даёт МАКСИМУМ уникальной пользы. Значит каждая страница должна нести оригинальные данные/цифры/сравнения, отвечать сразу и по делу, быть исчерпывающей и авторитетной (эксперт + источники).',
    kpis: ['AI Share of Voice — цитируют ли нас нейросети (по 3 движкам)', 'визиты из поиска', 'позиции топ-10', 'заявки/звонки'],
    geoLevers: ['оригинальные данные и первоисточники (то, чего нет у конкурентов)', 'ответ-сразу + структура (заголовки, таблицы, списки, FAQ)', 'исчерпывающая глубина по теме', 'явная авторитетность (автор-эксперт, Person/Article schema, ссылки на источники)', 'уникальность (не пересказ, а польза)'],
    constraints: ['не выдумывать факты', 'соблюдать E-E-A-T и 152-ФЗ', 'держаться дневного бюджета'],
  };
}

export function dailyBudgetUsd() { return PROFILE.autonomy?.dailyBudgetUsd ?? 3; }
export function autoApproveRisk() { return PROFILE.autonomy?.autoApprove ?? false; }

/** Дневной план новых страниц (0 = без явного плана, агент сам решает микс). */
export function dailyPageTarget() { return PROFILE.autonomy?.dailyPageTarget ?? 0; }

/** Сколько новых страниц уже опубликовано СЕГОДНЯ (успешные generate_article в журнале). */
export function pagesPublishedToday() {
  const day = stamp().slice(0, 10);
  try {
    return readFileSync(JOURNAL, 'utf-8').trim().split('\n')
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
      .filter((j) => j.action === 'generate_article' && j.status === 'done' && String(j.ts).slice(0, 10) === day).length;
  } catch { return 0; }
}

const BONUS = join(DIR, 'budget-bonus.json'); // { 'YYYY-MM-DD': usd } — разовые добавки к дневному бюджету через /budget
/** Сколько $ добавлено к сегодняшнему бюджету вручную (/budget +N). */
export function budgetBonusToday() {
  const day = stamp().slice(0, 10);
  return Number(readJson(BONUS, {})[day]) || 0;
}
/** Поднять сегодняшний бюджет на usd (вернёт накопленный бонус за день). */
export function addBudgetBonus(usd) {
  ensure();
  const day = stamp().slice(0, 10);
  const b = readJson(BONUS, {});
  b[day] = (Number(b[day]) || 0) + Number(usd || 0);
  writeFileSync(BONUS, JSON.stringify(b, null, 2), 'utf-8');
  return b[day];
}

/** Записать решение/действие в журнал (для обучения и прозрачности). */
export async function logDecision(entry) {
  ensure();
  try { appendFileSync(JOURNAL, JSON.stringify({ ts: stamp(), ...entry }) + '\n', 'utf-8'); } catch {}
}

/** Последние N записей журнала (для контекста планировщика — «что уже делал»). */
export function recentJournal(n = 20) {
  try {
    return readFileSync(JOURNAL, 'utf-8').trim().split('\n').slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

/** Предложение на согласование человеку → в очередь + Telegram. */
export async function proposeAction(type, args) {
  ensure();
  const id = rid();
  const list = readJson(PROPOSALS, []);
  const item = { id, type, args, status: 'pending', createdAt: stamp() };
  list.unshift(item);
  writeFileSync(PROPOSALS, JSON.stringify(list.slice(0, 100), null, 2), 'utf-8');
  try {
    const { sendMessage, escapeHtml } = await import('../../bot/telegram.mjs');
    const body = Object.entries(args || {}).map(([k, v]) => `• ${k}: ${escapeHtml(String(v))}`).join('\n');
    await sendMessage(
      `🤖 <b>Агент предлагает:</b> ${escapeHtml(type)}\n${body}\n\n` +
      `Одобрить: <code>/approve ${id}</code> · Отклонить: <code>/reject ${id}</code>`,
    );
  } catch { /* нет бота — предложение всё равно в очереди */ }
  return { proposed: id };
}

export function pendingProposals() { return readJson(PROPOSALS, []).filter((p) => p.status === 'pending'); }
export function setProposalStatus(id, status) {
  const list = readJson(PROPOSALS, []);
  const p = list.find((x) => x.id === id);
  if (!p) return null;
  p.status = status; p.decidedAt = stamp();
  writeFileSync(PROPOSALS, JSON.stringify(list, null, 2), 'utf-8');
  return p;
}

/** Эксперименты: зафиксировать гипотезу и её метрику до/после (агент учится). */
export function startExperiment(hypothesis, metric, baseline) {
  ensure();
  const list = readJson(EXPERIMENTS, []);
  const id = rid();
  list.unshift({ id, hypothesis, metric, baseline, startedAt: stamp(), status: 'running' });
  writeFileSync(EXPERIMENTS, JSON.stringify(list.slice(0, 200), null, 2), 'utf-8');
  return id;
}
export function closeExperiment(id, result, outcome) {
  const list = readJson(EXPERIMENTS, []);
  const e = list.find((x) => x.id === id);
  if (!e) return null;
  e.result = result; e.outcome = outcome; e.closedAt = stamp(); e.status = 'closed';
  writeFileSync(EXPERIMENTS, JSON.stringify(list, null, 2), 'utf-8');
  return e;
}
export function runningExperiments() { return readJson(EXPERIMENTS, []).filter((e) => e.status === 'running'); }
