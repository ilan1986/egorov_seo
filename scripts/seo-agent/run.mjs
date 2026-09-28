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
import { popularQueries, webmasterReady, recrawl } from './lib/webmaster.mjs';
import { pageStats, metrikaReady, metrikaTotals, metrikaLanding, metrikaSources, metrikaPhrases, counterHealth } from './lib/metrika.mjs';
import { optimizeCtr, demandGaps } from './lib/ctr-optimize.mjs';
import { optimizeConversions } from './lib/conversion.mjs';
import { gatherHealth, fixIndexation, resubmitUnindexed, refreshCandidates, bounceCandidates, refreshPage, formatHealth, describeBrokenLinks, keywordCannibalization } from './lib/health.mjs';
import { arsenkinReady, lsiTerms, paaQuestions, wordstat, relevantUrls } from './lib/arsenkin.mjs';
import {
  existingPages, internalLinkPool, loadUsedQueries, saveUsedQueries, writeBlogPost,
  blogPostExists, updateLlmsTxt, queueList, queueCount, queuePath, targetUrlBase,
} from './lib/content.mjs';
import { generatePost, factcheckPost } from './lib/generate-post.mjs';
import { checkUniqueness } from './lib/uniqueness.mjs';
import { indexNowPing } from './lib/indexnow.mjs';
import { isBlockedKeyword } from './lib/blocklist.mjs';
import { sendMessage, escapeHtml } from '../bot/telegram.mjs';
import { PROFILE } from '../../site.profile.mjs';

const t0 = Date.now();
const log = (...a) => console.log('[agent]', ...a);
const created = [], skipped = [], errors = [];
const today = () => new Date().toISOString().slice(0, 10);
const bodyOf = (mdx) => mdx.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)?.[1] || mdx;

let buildAlerted = false; // чтобы main().catch не слал второй алерт

// Прогнать команду, сохранив вывод в cron-лог; вернуть {ok, out} вместо падения.
function runStep(cmd) {
  try {
    const out = execSync(cmd, { cwd: ROOT_DIR, stdio: 'pipe' });
    process.stdout.write(out);
    return { ok: true, out: out.toString() };
  } catch (e) {
    const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
    process.stdout.write(out);
    return { ok: false, out };
  }
}

// Оповестить в Telegram о провале сборки/деплоя. Раньше build падал ДО отправки отчёта, и сайт
// молча стоял днями (nalog: 15 дней, vradok: 8) — теперь падение видно на следующее утро.
async function alertBuildFail(stage, out) {
  buildAlerted = true;
  const loc = out.match(/[^\s]+\.mdx:\d+:\d+/)?.[0] || out.match(/src\/content\/[^\s]+\.mdx/)?.[0] || '';
  const tail = out.split('\n').filter(Boolean).slice(-6).join('\n').slice(0, 600);
  const msg = [
    `🛑 <b>${escapeHtml(CONFIG.siteName || CONFIG.siteUrl || 'сайт')}: ${escapeHtml(stage)} УПАЛ(А)</b>`,
    'Сайт не обновился, сгенерированные страницы не опубликованы.',
    loc ? `\nФайл: <code>${escapeHtml(loc)}</code>` : '',
    tail ? `\n<code>${escapeHtml(tail)}</code>` : '',
  ].filter(Boolean).join('\n');
  try { if (readiness().telegram) await sendMessage(msg); } catch (e) { log('telegram-alert:', e.message); }
}

async function deployAndPing(extraUrls = []) {
  updateLlmsTxt();
  log('сборка + деплой…');
  const PY = process.platform === 'win32' ? 'python' : 'python3';
  const build = runStep('npm run build');
  if (!build.ok) { await alertBuildFail('НОЧНАЯ СБОРКА', build.out); throw new Error('build failed'); }
  const deploy = runStep(`${PY} scripts/deploy-ftp.py`);
  if (!deploy.ok) { await alertBuildFail('ДЕПЛОЙ (FTP)', deploy.out); throw new Error('deploy failed'); }
  const urls = [...created.map((u) => `${CONFIG.siteUrl}${u}`), ...extraUrls];
  const idx = await indexNowPing([CONFIG.siteUrl + '/', ...urls]);
  log('переиндексация:', JSON.stringify(idx));
  for (const u of urls) { try { await recrawl(u); } catch { /* игнор */ } }
}

// ── Публикация из очереди (батч) ─────────────────────
async function publishFromQueue(limit) {
  const files = queueList();
  const accepted = [];
  for (const file of files) {
    if (accepted.length >= limit) break;
    const slug = file.replace(/.*[\\/]q-(?:[a-z]+-)?\d+-/, '').replace(/\.mdx?$/, ''); // поддержка q-ch-<id>- (темы канала), иначе slug=полный путь → статья в articles/opt/...
    if (blogPostExists(slug)) { rmSync(file); continue; }
    let mdx = readFileSync(file, 'utf-8').replace(/^pubDate:.*$/m, `pubDate: ${today()}`);
    if (readiness().uniqueness) {
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
    created.push(`${targetUrlBase()}${slug}/`);
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

  const realQueries = wmQueries.map((q) => q.query).slice(0, 30);

  // Приоритет реальному спросу Яндекса (DEMAND): темы, где спрос есть, а мы не в топе
  let demandQueries = [];
  try { demandQueries = (await demandGaps({ top: 10 })).map((d) => d.query); }
  catch (e) { errors.push('demand: ' + e.message); }
  // Реальные поисковые фразы Метрики (как люди реально формулируют) — тоже приоритет
  let phraseQueries = [];
  try { phraseQueries = (await metrikaPhrases({ days: 90, limit: 15 })).map((p) => p.phrase); }
  catch { /* нет данных */ }
  const demandSet = new Set([...demandQueries, ...phraseQueries].map((q) => q.toLowerCase()));

  let candidates = [...demandQueries, ...phraseQueries];
  try {
    const out = await ask('Ты SEO-стратег. Отвечай списком запросов.',
      `Ниша: ${PROFILE.generation.topicClusters}. Уже есть: ${pages.map((p) => p.title).join('; ')}.` +
      (realQueries.length ? ` Запросы сайта: ${realQueries.join('; ')}.` : '') +
      ` Предложи 25 НОВЫХ long-tail запросов для статей, по одному на строку, без нумерации.`,
      { maxTokens: 1500, temperature: 0.8 });
    candidates.push(...out.split('\n').map((s) => s.replace(/^[\d.\-)\s]+/, '').trim()).filter((s) => s.length > 8));
  } catch (e) { errors.push('расширение ключей: ' + e.message); }
  candidates = [...new Set(candidates)];

  const fresh = candidates.filter((q) => {
    const ql = q.toLowerCase();
    if (used.has(ql)) return false;
    if (isBlockedKeyword(q)) return false; // конкурент-бренд/чужой город → не тратим API на заведомо блокируемое
    for (const c of covered) if (c.length > 6 && (ql.includes(c) || c.includes(ql))) return false;
    return true;
  });
  // спросовые темы — вперёд очереди на скоринг
  const ordered = [...fresh].sort((a, b) => Number(demandSet.has(b.toLowerCase())) - Number(demandSet.has(a.toLowerCase())));
  // Wordstat-частотность (одной задачей) — приоритет темам с реальным объёмом
  const freq = new Map();
  if (arsenkinReady()) {
    try { for (const w of await wordstat(ordered.slice(0, 8))) freq.set(w.phrase.toLowerCase(), w.exact ?? w.base ?? 0); }
    catch (e) { errors.push('wordstat: ' + e.message); }
  }
  const scored = [];
  for (const q of ordered.slice(0, 8)) {
    const bonus = demandSet.has(q.toLowerCase()) ? 100 : 0; // подтверждённый спрос важнее догадок xmlstock
    const f = freq.get(q.toLowerCase()) || 0;
    const freqBonus = f > 0 ? Math.min(50, Math.log10(f + 1) * 15) : 0; // объём Wordstat → бонус к приоритету
    try { const s = scoreOpportunity(await yandexSerp(q, { groups: 10 })); scored.push({ query: q, ...s, freq: f, ease: (s.ease || 0) + bonus + freqBonus }); }
    catch { scored.push({ query: q, freq: f, ease: bonus + freqBonus }); }
    await new Promise((r) => setTimeout(r, 800));
  }
  scored.sort((a, b) => b.ease - a.ease);
  const picks = scored.slice(0, CONFIG.agent.maxNew);

  const pool = internalLinkPool();
  const accepted = [];
  for (const [i, pick] of picks.entries()) {
    log(`генерация ${i + 1}/${picks.length}: «${pick.query}»…`);
    try {
      // Arsenkin: LSI-термины топ-10 + реальные вопросы PAA → в промпт статьи
      let lsi = [], paa = [];
      if (arsenkinReady()) {
        try { lsi = (await lsiTerms(pick.query)).lsi.map((x) => x.word); } catch (e) { errors.push('lsi: ' + e.message); }
        try { paa = (await paaQuestions(pick.query)).map((x) => x.question); } catch (e) { errors.push('paa: ' + e.message); }
      }
      const { slug, mdx } = await generatePost({ keyword: pick.query, internalLinks: pool, pubDateISO: today(), lsi, paa });
      if (blogPostExists(slug)) { skipped.push(`${pick.query} — slug занят`); continue; }
      const fc = await factcheckPost(mdx, { minUnique: CONFIG.textru.minUnique, checkUnique: readiness().uniqueness });
      if (!fc.pass) { skipped.push(`${pick.query} — ${fc.issues.join('; ')}`); continue; }
      writeBlogPost(slug, mdx);
      accepted.push(slug);
      created.push(`${targetUrlBase()}${slug}/`);
      saveUsedQueries([...loadUsedQueries(), pick.query]);
      log(`+ ${slug}`);
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
  } else {
    mode = 'живая генерация';
    published = await liveGenerate();
  }

  // Снапшот Метрики (поведение + конверсии) — для оптимизаций и отчёта
  let mTotals = null, mLanding = [], mSources = [], cHealth = null;
  if (metrikaReady()) {
    try {
      [mTotals, mLanding, mSources, cHealth] = await Promise.all([
        metrikaTotals({ days: 30 }), metrikaLanding({ days: 90 }), metrikaSources({ days: 90 }), counterHealth(),
      ]);
    } catch (e) { errors.push('metrika: ' + e.message); }
  }

  // Шаг 6 воркфлоу: CTR-оптимизатор — страницы с показами, но без кликов
  let ctrChanged = [];
  if (!CONFIG.agent.dryRun && webmasterReady()) {
    try { ctrChanged = await optimizeCtr({ limit: 3, minImpr: 5 }); }
    catch (e) { errors.push('ctr: ' + e.message); }
    for (const c of ctrChanged) log(`CTR: ${c.url} → «${c.now}»`);
  }

  // Конверсионный оптимизатор: страницы с трафиком, но 0 заявок → усилить CTA
  let convChanged = [];
  if (!CONFIG.agent.dryRun && metrikaReady()) {
    try { convChanged = await optimizeConversions({ limit: 2, minVisits: 10 }); }
    catch (e) { errors.push('conv: ' + e.message); }
    for (const c of convChanged) log(`CONV: усилен CTA ${c.path} (${c.visits} визитов, 0 заявок)`);
  }

  // Авто-рефреш: застрявшая на 2-й странице (поз.11–30) ИЛИ с высоким отказом статья → свежий раздел
  let refreshed = [];
  if (!CONFIG.agent.dryRun && (webmasterReady() || metrikaReady()) && process.env.REFRESH_STUCK !== '0') {
    try {
      const cands = [...(webmasterReady() ? await refreshCandidates() : []), ...bounceCandidates(mLanding)];
      for (const c of cands) { const r = await refreshPage(c); if (r) { refreshed.push(r); break; } } // 1 за прогон
    } catch (e) { errors.push('refresh: ' + e.message); }
    for (const r of refreshed) log(`REFRESH: ${r.url}`);
  }

  // Единый деплой, если появились новые статьи, переписаны мета-теги, усилен CTA или сделан рефреш
  const extraUrls = [
    ...ctrChanged.map((c) => CONFIG.siteUrl + c.url),
    ...convChanged.map((c) => CONFIG.siteUrl + c.path),
    ...refreshed.map((r) => CONFIG.siteUrl + r.url),
  ];
  if (!CONFIG.agent.dryRun && (created.length || ctrChanged.length || convChanged.length || refreshed.length)) {
    await deployAndPing(extraUrls);
  }

  // Мониторинг индексации + авто-переобход ошибок обхода и новых страниц
  let health = null, indexFix = { recrawled: [] }, reindex = { submitted: [], unindexedTotal: 0 };
  if (webmasterReady()) {
    try {
      health = await gatherHealth();
      if (!CONFIG.agent.dryRun) {
        indexFix = await fixIndexation(created.map((u) => CONFIG.siteUrl + u), health);
        // Постоянный досыл ранее опубликованных, но ещё не проиндексированных страниц.
        // Бюджет 15/прогон + кулдаун 14 дней бережёт дневную квоту переобхода Вебмастера.
        reindex = await resubmitUnindexed({ budget: 15, cooldownDays: 14 });
      }
    } catch (e) { errors.push('health: ' + e.message); }
  }

  // Кандидаты на новые страницы: высокий спрос Яндекса, а мы не в топе
  let gaps = [];
  if (webmasterReady()) { try { gaps = await demandGaps({ top: 6 }); } catch { /* игнор */ } }

  // Каннибализация: страницы, конкурирующие за одни ключи
  const cannib = keywordCannibalization(existingPages()).slice(0, 3);

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  const left = queueCount();
  const top = (await popularQueries({ limit: 100 }).catch(() => [])).filter((q) => q.position && q.position <= 30).length;
  const orgVisits = mSources.length ? (mSources.find((s) => /Search engine|Поиск|organic/i.test(s.source))?.visits ?? 0) : null;
  // CS_ERR_UNKNOWN не считаем поломкой: у сайтов с cookie-консентом (152-ФЗ) Метрика грузится только
  // после согласия, а проверочный бот Яндекса cookie не принимает → «код не найден», хотя данные идут.
  // Реальное отсутствие счётчика ловит диагностика Вебмастера (NO_METRIKA_COUNTER), а не этот статус.
  const codeAlert = cHealth?.codeStatus && cHealth.codeStatus !== 'CS_OK' && cHealth.codeStatus !== 'CS_ERR_UNKNOWN' ? cHealth.codeStatus : '';
  const esc = (arr) => arr.map((s) => '• ' + escapeHtml(s)).join('\n');
  const report = [
    `<b>SEO-агент — прогон завершён</b> (${mins} мин)`,
    CONFIG.agent.dryRun ? '⚙️ DRY_RUN' : `🚀 режим: ${mode}`,
    `Опубликовано: ${published.length}${created.length ? '\n' + esc(created) : ''}`,
    ctrChanged.length ? `🎯 CTR-оптимизация: ${ctrChanged.length}\n${esc(ctrChanged.map((c) => `${c.now}  (${c.impressions} показов, 0 кликов)`))}` : '',
    convChanged.length ? `🧲 Усилен CTA (трафик без заявок): ${convChanged.length}\n${esc(convChanged.map((c) => `${c.path}  (${c.visits} визитов)`))}` : '',
    mTotals ? `📊 Метрика 30д: ${mTotals.visits} визитов${orgVisits != null ? ` (органика ${orgVisits})` : ''} · отказы ${Math.round(mTotals.bounce)}% · заявки ${mTotals.conversions ?? '—'}` : '',
    codeAlert ? `⚠️ Счётчик Метрики: ${escapeHtml(codeAlert)} — проверьте установку кода` : '',
    gaps.length ? `📈 Высокий спрос, мы не в топе:\n${esc(gaps.map((g) => `${g.query} — спрос ${g.demand.toFixed(2)}`))}` : '',
    cannib.length ? `⚔️ Каннибализация (общие ключи):\n${esc(cannib.map((c) => `${c.a} ↔ ${c.b}: ${c.shared.slice(0, 2).join(', ')}`))}` : '',
    health ? formatHealth(health, { recrawled: indexFix.recrawled, refreshed }).join('\n') : '',
    reindex.unindexedTotal ? `♻️ Не в индексе: ${reindex.unindexedTotal}, досланы на переобход: ${reindex.submitted.length}` : '',
    health?.broken?.count ? `🔗 Битые ссылки:\n${esc(describeBrokenLinks(health.broken).map((b) => `${b.from} → ${b.to}`))}` : '',
    left ? `📦 В очереди осталось: ${left}` : 'Очередь пуста',
    skipped.length ? `Пропущено: ${skipped.length}\n${esc(skipped.slice(0, 6))}` : 'Пропущено: 0',
    errors.length ? `Ошибок: ${errors.length}\n${esc(errors.slice(0, 4))}` : 'Ошибок: 0',
    webmasterReady() ? `Запросов в топ-30: ${top}` : '',
  ].filter(Boolean).join('\n');
  log('\n' + report.replace(/<\/?b>/g, ''));
  try { if (readiness().telegram) await sendMessage(report); } catch (e) { log('telegram:', e.message); }
}

main().catch(async (e) => {
  console.error('[agent] FATAL', e);
  if (!buildAlerted) {
    try {
      if (readiness().telegram) {
        await sendMessage(`🛑 <b>${escapeHtml(CONFIG.siteName || CONFIG.siteUrl || 'сайт')}: прогон агента упал</b>\n<code>${escapeHtml(String(e?.message || e)).slice(0, 500)}</code>`);
      }
    } catch { /* игнор */ }
  }
  process.exit(1);
});
