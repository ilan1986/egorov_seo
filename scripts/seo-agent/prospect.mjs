// CRM лидов (агентский режим): воронка ПОТЕНЦИАЛЬНЫХ КЛИЕНТОВ (не заявки с сайта!).
// Кому продать SEO/GEO-услугу: сайт-кандидат → статус → напоминания → выигран/проигран.
// Хранилище: data/agency/prospects.json. CLI + функции для агента.
// CLI: node scripts/seo-agent/prospect.mjs add <url> [имя] | list [статус] | set <id> <статус> | note <id> <текст>
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR } from './config.mjs';

const DIR = join(ROOT_DIR, 'scripts/seo-agent/data/agency');
const FILE = join(DIR, 'prospects.json');
const STATUSES = ['new', 'contacted', 'audit_sent', 'proposal_sent', 'negotiating', 'won', 'lost'];
const LABEL = { new: '🆕 Новый', contacted: '📨 Написал', audit_sent: '📊 Аудит отправлен', proposal_sent: '📄 КП отправлено', negotiating: '🤝 Переговоры', won: '✅ Выигран', lost: '❌ Проигран' };

const load = () => { try { return JSON.parse(readFileSync(FILE, 'utf-8')); } catch { return []; } };
const save = (l) => { mkdirSync(DIR, { recursive: true }); writeFileSync(FILE, JSON.stringify(l, null, 2), 'utf-8'); };
const rid = () => Math.random().toString(36).slice(2, 8);
const now = () => new Date().toISOString();

export function addProspect(url, name = '', extra = {}) {
  const list = load();
  const clean = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (list.find((p) => p.url === clean)) return { error: 'уже в воронке', url: clean };
  const p = { id: rid(), url: clean, name, status: 'new', createdAt: now(), updatedAt: now(), notes: [], ...extra };
  list.unshift(p); save(list); return p;
}
export function setStatus(id, status) {
  if (!STATUSES.includes(status)) return { error: 'статус: ' + STATUSES.join('|') };
  const list = load(); const p = list.find((x) => x.id === id || x.url === id);
  if (!p) return { error: 'не найден' };
  p.status = status; p.updatedAt = now(); save(list); return p;
}
export function addNote(id, text) {
  const list = load(); const p = list.find((x) => x.id === id || x.url === id);
  if (!p) return { error: 'не найден' };
  p.notes.push({ ts: now().slice(0, 16), text }); p.updatedAt = now(); save(list); return p;
}
export function listProspects(status) { return load().filter((p) => !status || p.status === status); }

export function funnelSummary() {
  const list = load();
  const by = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const p of list) by[p.status] = (by[p.status] || 0) + 1;
  const active = list.filter((p) => !['won', 'lost'].includes(p.status)).length;
  return { total: list.length, active, won: by.won, lost: by.lost, by };
}

export function fmtFunnel() {
  const f = funnelSummary();
  const lines = [`🎯 <b>Воронка клиентов</b> — активных ${f.active}, выиграно ${f.won}, проиграно ${f.lost}`, ''];
  for (const s of STATUSES) if (f.by[s]) lines.push(`${LABEL[s]}: ${f.by[s]}`);
  const active = listProspects().filter((p) => !['won', 'lost'].includes(p.status)).slice(0, 15);
  if (active.length) { lines.push('', '<b>В работе:</b>'); for (const p of active) lines.push(`• ${p.url}${p.name ? ` (${p.name})` : ''} — ${LABEL[p.status]} <code>${p.id}</code>`); }
  return lines.join('\n');
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'add') console.log(JSON.stringify(addProspect(rest[0], rest.slice(1).join(' ')), null, 1));
  else if (cmd === 'list') for (const p of listProspects(rest[0])) console.log(`${p.id} ${p.status.padEnd(14)} ${p.url} ${p.name || ''}`);
  else if (cmd === 'set') console.log(JSON.stringify(setStatus(rest[0], rest[1])));
  else if (cmd === 'note') console.log(JSON.stringify(addNote(rest[0], rest.slice(1).join(' '))));
  else console.log(fmtFunnel().replace(/<[^>]+>/g, ''));
}
