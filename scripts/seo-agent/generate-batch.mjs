// Массовая генерация статей в очередь (data/queue). Полный pipeline без text.ru
// (уникальность проверяется при публикации по 5/день). Запуск: node scripts/seo-agent/generate-batch.mjs
// Кол-во: BATCH_COUNT (по умолчанию 150). Резюмируемо — продолжает добивать очередь до цели.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG } from './config.mjs';
import { ask } from './lib/aigate.mjs';
import { generatePost, factcheckPost } from './lib/generate-post.mjs';
import {
  existingPages, internalLinkPool, loadUsedQueries, queuePath, queueCount, queuedSlugs, blogPostExists,
} from './lib/content.mjs';
import { sendMessage } from '../bot/telegram.mjs';

const TARGET = Number(process.env.BATCH_COUNT || 150);
const log = (...a) => console.log('[batch]', ...a);
const norm = (s) => s.toLowerCase().replace(/[«»"'`,.()]/g, '').trim();

const pages = existingPages();
const coveredTitles = pages.map((p) => p.title);
const seen = new Set([...coveredTitles.map(norm), ...loadUsedQueries().map(norm), ...queuedSlugs().map(norm)]);
const pool = internalLinkPool();
const genDate = new Date().toISOString().slice(0, 10); // дата ставится реальная при публикации

const CLUSTERS =
  'бухгалтерия и налоги маркетплейсов (Wildberries, Ozon, Яндекс Маркет, Мегамаркет, Авито); ' +
  'УСН «доходы» и «доходы минус расходы»; ПСН/патент; АУСН; ОСНО и НДС; ЕСХН; налоговая оптимизация; ' +
  'требования и проверки ФНС (камеральные, выездные); дробление бизнеса; самозанятые и НПД; ' +
  'страховые взносы ИП; расчёт зарплаты и кадры; регистрация и ликвидация ИП/ООО; смена налогового режима; ' +
  'восстановление учёта в 1С; вычеты и льготы; блокировка счёта по 115-ФЗ; ЕНС и ЕНП; онлайн-кассы и ОФД; ' +
  'учёт для услуг, торговли, общепита, IT, грузоперевозок, аренды';

let topics = [];
async function moreTopics(n) {
  const out = await ask(
    'Ты SEO-стратег по налогам и бухгалтерии РФ. Отвечай только списком тем.',
    `Дай ${n} НОВЫХ информационных тем-заголовков для статей блога бухгалтера-эксперта (актуально на 2026), ` +
      `long-tail, с реальным поисковым спросом, по кластерам: ${CLUSTERS}. ` +
      `Каждая тема — конкретный вопрос или проблема предпринимателя, не общие фразы. ` +
      `НЕ повторяй уже имеющиеся темы. По одной теме на строку, без нумерации и кавычек.`,
    { maxTokens: 2500, temperature: 0.95 }
  );
  return out.split('\n').map((s) => s.replace(/^[\d.\-)\s]+/, '').trim()).filter((s) => s.length > 10);
}
async function nextTopic() {
  let guard = 0;
  while (guard < 50) {
    if (!topics.length) { topics = await moreTopics(40); guard++; }
    if (!topics.length) return null;
    const t = topics.shift();
    if (seen.has(norm(t))) continue;
    seen.add(norm(t));
    return t;
  }
  return null;
}

let made = queueCount();
let ok = 0, fail = 0, idx = made;
log(`старт. цель ${TARGET}, уже в очереди ${made}`);
if (CONFIG.telegram.token) { try { await sendMessage(`📦 Старт батч-генерации: цель ${TARGET} статей в очередь.`); } catch {} }

while (made < TARGET) {
  const topic = await nextTopic();
  if (!topic) { log('темы исчерпаны'); break; }
  try {
    const { slug, mdx } = await generatePost({ keyword: topic, internalLinks: pool, pubDateISO: genDate });
    if (blogPostExists(slug) || queuedSlugs().includes(slug)) { fail++; continue; }
    const fc = await factcheckPost(mdx, { checkUnique: false });
    if (!fc.pass) { log(`✗ ${topic} — ${fc.issues.join('; ')}`); fail++; continue; }
    idx++;
    writeFileSync(join(queuePath(), `q-${String(idx).padStart(4, '0')}-${slug}.mdx`), mdx, 'utf-8');
    made++; ok++;
    log(`+ [${made}/${TARGET}] ${fc.words}w — ${slug}`);
    if (ok % 10 === 0 && CONFIG.telegram.token) {
      try { await sendMessage(`📦 Батч: в очереди ${made}/${TARGET} (фактчек пройден).`); } catch {}
    }
  } catch (e) { log(`! ${topic}: ${e.message}`); fail++; }
}

log(`Готово. В очереди ${made}, скипов/ошибок ${fail}`);
if (CONFIG.telegram.token) {
  try { await sendMessage(`✅ Батч-генерация завершена: <b>${made}</b> статей в очереди на сервере. Публикуются автоматически по ${CONFIG.agent.maxNew}/день.`, { parseMode: 'HTML' }); } catch {}
}
