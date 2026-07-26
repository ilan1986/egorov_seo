// Агентский режим — обслуживание КЛИЕНТСКИХ сайтов. Один вход:
//   node scripts/seo-agent/client.mjs audit  <url> [Имя клиента]  → аудит + отчёт.html + КП.html + PDF-подсказка
//   node scripts/seo-agent/client.mjs report <url>               → только отчёт
//   node scripts/seo-agent/client.mjs kp     <url> [packageId]   → только КП
//   node scripts/seo-agent/client.mjs compare <url>              → динамика месяц-к-месяцу
// Требует раздел `agency` в site.profile.mjs (бренд/контакты/пакеты-тарифы).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR } from './config.mjs';
import { auditClientSite } from './lib/client-audit.mjs';
import { renderClientReport } from './lib/client-report.mjs';
import { renderProposal } from './lib/proposal.mjs';
import { storeAudit, compareLatest, fmtCompare } from './lib/compare.mjs';

const dir = (url) => { const d = join(ROOT_DIR, 'scripts/seo-agent/data/agency/clients', url.replace(/^https?:\/\//, '').replace(/[^\w.-]/g, '_')); mkdirSync(d, { recursive: true }); return d; };
const pdfHint = (html) => `PDF: chrome --headless --disable-gpu --print-to-pdf="${html.replace(/\.html$/, '.pdf')}" "file://${html}"`;

async function main() {
  const [cmd, url, ...rest] = process.argv.slice(2);
  if (!url) { console.log('Укажи URL. См. шапку файла.'); return; }

  if (cmd === 'compare') { console.log(fmtCompare(compareLatest(url)).replace(/<[^>]+>/g, '')); return; }

  console.log(`[client] аудит ${url}…`);
  const audit = await auditClientSite(url);
  console.log(`[client] оценка: общий ${audit.scores.overall} · SEO ${audit.scores.seo} · GEO ${audit.scores.geo} · страниц ${audit.signals.pagesChecked} · проблем ${audit.findings.length}`);
  const d = dir(audit.url);

  if (cmd === 'audit' || cmd === 'report') {
    const p = join(d, 'report.html'); writeFileSync(p, renderClientReport(audit), 'utf-8');
    console.log('отчёт:', p); console.log(pdfHint(p));
  }
  if (cmd === 'audit' || cmd === 'kp') {
    const p = join(d, 'proposal.html'); writeFileSync(p, renderProposal(audit, { clientName: rest.filter((x) => !/^pkg-/.test(x)).join(' '), packageId: rest.find((x) => /^pkg-/.test(x)) }), 'utf-8');
    console.log('КП:', p); console.log(pdfHint(p));
  }
  const n = storeAudit(audit);
  if (n >= 2) console.log('\n' + fmtCompare(compareLatest(audit.url)).replace(/<[^>]+>/g, ''));
}
main().catch((e) => { console.error('[client]', e.message); process.exit(1); });
