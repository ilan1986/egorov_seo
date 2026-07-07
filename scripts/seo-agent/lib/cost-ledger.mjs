// Учёт расходов по сервисам за день. Пишет в data/costs/YYYY-MM-DD.json — читает daily-report.mjs.
// Точность разная по сервисам (см. daily-report.mjs): aigate/kie.ai/content-watch — реальные $
// (API отдаёт cost_usd/баланс), Arsenkin/xmlstock — только счётчик запросов (баланс не публикуют).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR } from '../config.mjs';

const DIR = join(ROOT_DIR, 'scripts/seo-agent/data/costs');
const today = () => new Date().toISOString().slice(0, 10);
const filePath = (date) => join(DIR, `${date}.json`);

function load(date) {
  const p = filePath(date);
  if (!existsSync(p)) return { usd: {}, calls: {} };
  try {
    const d = JSON.parse(readFileSync(p, 'utf-8'));
    return { usd: d.usd || {}, calls: d.calls || {} };
  } catch {
    return { usd: {}, calls: {} };
  }
}
function save(date, data) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(filePath(date), JSON.stringify(data, null, 2), 'utf-8');
}

/** Записать реальный расход в USD по категории (aigate-generation, aigate-dialog, kie, content-watch...). */
export function logCostUsd(category, usd) {
  if (!usd || !Number.isFinite(usd) || usd <= 0) return;
  const date = today();
  const data = load(date);
  data.usd[category] = (data.usd[category] || 0) + usd;
  save(date, data);
}

/** Записать факт запроса к сервису без известной цены за вызов (Arsenkin, xmlstock). */
export function logCall(category) {
  const date = today();
  const data = load(date);
  data.calls[category] = (data.calls[category] || 0) + 1;
  save(date, data);
}

/** Расходы/вызовы за дату (по умолчанию сегодня). */
export function getCosts(date = today()) {
  return load(date);
}
