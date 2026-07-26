// Отчёт-дельта для удержания клиента (агентский режим): сравнивает текущий аудит с прошлым
// (месяц назад) и показывает динамику score + что починили / что появилось. Хранит историю аудитов.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR } from '../config.mjs';

const dir = (url) => join(ROOT_DIR, 'scripts/seo-agent/data/agency/clients', url.replace(/^https?:\/\//, '').replace(/[^\w.-]/g, '_'));
const HIST = (url) => join(dir(url), 'audits.json');

/** Сохранить аудит в историю клиента. */
export function storeAudit(audit) {
  const d = dir(audit.url); mkdirSync(d, { recursive: true });
  let h = []; try { h = JSON.parse(readFileSync(HIST(audit.url), 'utf-8')); } catch {}
  h.push({ at: audit.checkedAt, scores: audit.scores, findingsCount: audit.findings.length, findings: audit.findings.map((f) => f.msg) });
  writeFileSync(HIST(audit.url), JSON.stringify(h.slice(-24), null, 2), 'utf-8');
  return h.length;
}

/** Сравнить последний аудит с предыдущим. @returns дельта или null (нет истории). */
export function compareLatest(url) {
  let h = []; try { h = JSON.parse(readFileSync(HIST(url), 'utf-8')); } catch {}
  if (h.length < 2) return null;
  const [prev, cur] = [h[h.length - 2], h[h.length - 1]];
  const d = (k) => (cur.scores[k] ?? 0) - (prev.scores[k] ?? 0);
  const fixed = prev.findings.filter((f) => !cur.findings.includes(f));
  const appeared = cur.findings.filter((f) => !prev.findings.includes(f));
  return {
    url, from: prev.at, to: cur.at,
    delta: { overall: d('overall'), seo: d('seo'), geo: d('geo'), citability: d('citability') },
    scores: cur.scores, fixed, appeared,
  };
}

const arrow = (n) => (n > 0 ? `▲ +${n}` : n < 0 ? `▼ ${n}` : '= 0');

export function fmtCompare(cmp) {
  if (!cmp) return 'Нет данных для сравнения (нужно ≥2 аудита).';
  const L = [`📈 <b>Динамика ${cmp.url}</b> (${cmp.from} → ${cmp.to})`, ''];
  L.push(`Общий: ${cmp.scores.overall} (${arrow(cmp.delta.overall)}) · SEO ${arrow(cmp.delta.seo)} · GEO ${arrow(cmp.delta.geo)} · цитируемость ${arrow(cmp.delta.citability)}`);
  if (cmp.fixed.length) { L.push('', `✅ <b>Исправлено (${cmp.fixed.length}):</b>`); cmp.fixed.slice(0, 8).forEach((f) => L.push('• ' + f)); }
  if (cmp.appeared.length) { L.push('', `⚠️ <b>Появилось (${cmp.appeared.length}):</b>`); cmp.appeared.slice(0, 6).forEach((f) => L.push('• ' + f)); }
  return L.join('\n');
}
