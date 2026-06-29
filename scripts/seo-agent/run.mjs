// SEO-агент. Режимы:
//  1) ОЧЕРЕДЬ: если в data/queue есть готовые статьи — публикует до MAX_NEW в день
//     (с проверкой уникальности text.ru именно публикуемых, дата ставится текущая).
//  2) ЖИВАЯ ГЕНЕРАЦИЯ: если очередь пуста — генерит сам (сбор→ключи→gap→ген→фактчек→публикация).
// Запуск: node scripts/seo-agent/run.mjs
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, renameSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CONFIG, ROOT_DIR, readiness } from './config.mjs';
import { ask } from './lib/aigate.mjs';
import { yandexSerp, scoreOpportunity } from './lib/xmlstock.mjs';
import { popularQueries, webmasterReady } from './lib/webmaster.mjs';
import { pageStats } from './lib/metrika.mjs';
import {
  existingPages, internalLinkPool, loadUsedQueries, saveUsedQueries, writeBlogPost,
  blogPostExists, updateLlmsTxt, queueList, queueCount, queuePath,
} from './lib/content.mjs';
import { generatePost, factcheckPost } from './lib/generate-post.mjs';
import { checkUniqueness } from './lib/textru.mjs';
import { indexNowPing } from './lib/indexnow.mjs';
import { sendMessage, escapeHtml } from '../bot/telegram.mjs';

const t0 = Date.now();
const log = (...a) => console.log('[agent]', ...a);
const created = [], skipped = [], errors = [];
const today = () => new Date().toISOString().slice(0, 10);
const bodyOf = (mdx) => mdx.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)?.[1] || mdx;

async function deployAndPing() {
  updateLlmsTxt();
  log('сборка + деплой…');
  const PY = process.platform === 'win32' ? 'python' : 'python3';
  execSync('npm run build', { cwd: ROOT_DIR, stdio: 'inherit' });
  execSync(`${PY} scripts/deploy-ftp.py`, { cwd: ROOT_DIR, stdio: 'inherit' });
  const urls = created.map((u) => `${CONFIG.siteUrl}${u}`);
  const idx = await indexNowPing([CONFIG.siteUrl + '/', ...urls]);
  log('переиндексация:', JSON.stringify(idx));
}

// ── Публикация из очереди (батч) ─────────────────────
async function publishFromQueue(limit) {
  const files = queueList();
  const accepted = [];
  for (const file of files) {
    if (accepted.length >= limit) break;
    const slug = file.replace(/.*[\\/]q-\d+-/, '').replace(/\.mdx?$/, '');
    if (blogPostExists(slug)) { rmSync(file); continue; }
    let mdx = readFileSync(file, 'utf-8').replace(/^pubDate:.*$/m, `pubDate: ${today()}`);
    if (readiness().textru) {
      try {
        const r = await checkUniqueness(bodyOf(mdx).slice(0, 12000), { tries: 25, delayMs: 6000 });
        if (r.unique != null && r.unique < CONFIG.textru.minUnique) {
          const rej = join(queuePath(), 'rejected');
          mkdirSync(rej, { recursive: true });
          renameSync(file, join(rej, basename(file)));
          skipped.push(`${slug} — уникальность ${r.unique}%`);
          continue;
        }
      } catch (e) { errors.push(`text.ru ${slug}: ${e.message}`); continue; }
    }
    writeBlogPost(slug, mdx);
    rmSync(file);
    accepted.push(slug);
    created.push(`/blog/${slug}/`);
    log(`+ из очереди: ${slug}`);
  }
  return accepted;
}

// ── Живая генерация (fallback, если очередь пуста) ────
async function liveGenerate() {
  const pages = existingPages();
  const covered = new Set(pages.flatMap((p) => [p.title.toLowerCase(), ...p.keywords.map((k) => k.toLowerCase())]));
  const used = new Set(loadUsedQueries().map((q) => q.toLowerCase()));
  const [wmQueries] = await Promise.all([popularQueries({ limit: 100 }), pageStats({ days: 30 })]);

  const seedThemes = [
    'налоги и бухгалтерия маркетплейсов', 'УСН, ПСН, АУСН, ОСНО', 'налоговая оптимизация и проверки ФНС',
    'учёт ИП и ООО, самозанятые, страховые взносы',
  ];
  const realQueries = wmQueries.map((q) => q.query).slice(0, 30);
  let candidates = [];
  try {
    const out = await ask('Ты SEO-стратег. Отвечай списком запросов.',
      `Ниша: бухгалтерия/налоги РФ 2026. Темы: ${seedThemes.join('; ')}. Уже есть: ${pages.map((p) => p.title).join('; ')}.` +
      (realQueries.length ? ` Запросы сайта: ${realQueries.join('; ')}.` : '') +
      ` Предложи 25 НОВЫХ long-tail запросов для статей, по одному на строку, без нумерации.`,
      { maxTokens: 1500, temperature: 0.8 });
    candidates = out.split('\n').map((s) => s.replace(/^[\d.\-)\s]+/, '').trim()).filter((s) => s.length > 8);
  } catch (e) { errors.push('расширение ключей: ' + e.message); }

  const fresh = candidates.filter((q) => {
    const ql = q.toLowerCase();
    if (used.has(ql)) return false;
    for (const c of covered) if (c.length > 6 && (ql.includes(c) || c.includes(ql))) return false;
    return true;
  });
  const scored = [];
  for (const q of fresh.slice(0, 8)) {
    try { scored.push({ query: q, ...scoreOpportunity(await yandexSerp(q, { groups: 10 })) }); }
    catch { scored.push({ query: q, ease: 0 }); }
    await new Promise((r) => setTimeout(r, 800));
  }
  scored.sort((a, b) => b.ease - a.ease);
  const picks = scored.slice(0, CONFIG.agent.maxNew);

  const pool = internalLinkPool();
  const accepted = [];
  for (const pick of picks) {
    try {
      const { slug, mdx } = await generatePost({ keyword: pick.query, internalLinks: pool, pubDateISO: today() });
      if (blogPostExists(slug)) { skipped.push(`${pick.query} — slug занят`); continue; }
      const fc = await factcheckPost(mdx, { minUnique: CONFIG.textru.minUnique, checkUnique: readiness().textru });
      if (!fc.pass) { skipped.push(`${pick.query} — ${fc.issues.join('; ')}`); continue; }
      writeBlogPost(slug, mdx);
      accepted.push(slug);
      created.push(`/blog/${slug}/`);
      saveUsedQueries([...loadUsedQueries(), pick.query]);
    } catch (e) { errors.push(`${pick.query}: ${e.message}`); }
  }
  return accepted;
}

async function main() {
  log('старт. DRY_RUN =', CONFIG.agent.dryRun, '| MAX_NEW =', CONFIG.agent.maxNew, '| очередь:', queueCount());
  let mode = '';
  let published = [];

  if (CONFIG.agent.dryRun) {
    log('DRY_RUN — публикация отключена');
  } else if (queueCount() > 0) {
    mode = 'очередь';
    published = await publishFromQueue(CONFIG.agent.maxNew);
    if (published.length) await deployAndPing();
  } else {
    mode = 'живая генерация';
    published = await liveGenerate();
    if (published.length) await deployAndPing();
  }

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  const left = queueCount();
  const top = (await popularQueries({ limit: 100 }).catch(() => [])).filter((q) => q.position && q.position <= 30).length;
  const esc = (arr) => arr.map((s) => '• ' + escapeHtml(s)).join('\n');
  const report = [
    `<b>SEO-агент — прогон завершён</b> (${mins} мин)`,
    CONFIG.agent.dryRun ? '⚙️ DRY_RUN' : `🚀 режим: ${mode}`,
    `Опубликовано: ${published.length}${created.length ? '\n' + esc(created) : ''}`,
    left ? `📦 В очереди осталось: ${left}` : 'Очередь пуста',
    skipped.length ? `Пропущено: ${skipped.length}\n${esc(skipped.slice(0, 6))}` : 'Пропущено: 0',
    errors.length ? `Ошибок: ${errors.length}\n${esc(errors.slice(0, 4))}` : 'Ошибок: 0',
    webmasterReady() ? `Запросов в топ-30: ${top}` : '',
  ].filter(Boolean).join('\n');
  log('\n' + report.replace(/<\/?b>/g, ''));
  try { if (readiness().telegram) await sendMessage(report); } catch (e) { log('telegram:', e.message); }
}

main().catch((e) => { console.error('[agent] FATAL', e); process.exit(1); });
