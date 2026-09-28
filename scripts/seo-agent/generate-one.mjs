// Целевая генерация ОДНОЙ страницы по заданной теме (вызывается из бота: /newpage <тема>).
// Тот же конвейер, что у ночного агента: генерация → фактчек уникальности → запись →
// сборка → деплой → переиндексация (IndexNow + Вебмастер). По завершении шлёт итог в Telegram.
// Запуск: node scripts/seo-agent/generate-one.mjs "<тема>" [chatId]
import { execSync } from 'node:child_process';
import { CONFIG, ROOT_DIR, readiness } from './config.mjs';
import {
  internalLinkPool, writeBlogPost, blogPostExists, updateLlmsTxt,
  targetUrlBase, loadUsedQueries, saveUsedQueries,
} from './lib/content.mjs';
import { generatePost, factcheckPost } from './lib/generate-post.mjs';
import { indexNowPing } from './lib/indexnow.mjs';
import { recrawl } from './lib/webmaster.mjs';
import { sendMessage, escapeHtml } from '../bot/telegram.mjs';

const keyword = (process.argv[2] || '').trim();
const chatId = process.argv[3] || undefined;
const today = () => new Date().toISOString().slice(0, 10);
const notify = async (t) => { try { await sendMessage(t, chatId ? { chatId } : undefined); } catch {} };

function runStep(cmd) {
  try { return { ok: true, out: execSync(cmd, { cwd: ROOT_DIR, stdio: 'pipe' }).toString() }; }
  catch (e) { return { ok: false, out: (e.stdout?.toString() || '') + (e.stderr?.toString() || '') }; }
}

async function main() {
  if (keyword.length < 6) { await notify('⚠️ Тема слишком короткая.'); return; }

  // 1) Генерация статьи по теме
  let slug, mdx;
  try {
    const pool = internalLinkPool();
    ({ slug, mdx } = await generatePost({ keyword, internalLinks: pool, pubDateISO: today() }));
  } catch (e) { await notify(`⚠️ Ошибка генерации: ${escapeHtml(e.message)}`); return; }

  if (blogPostExists(slug)) {
    await notify(`ℹ️ Страница по этой теме уже есть: <code>${escapeHtml(slug)}</code>. Ничего не менял.`);
    return;
  }

  // 2) Фактчек + уникальность (text.ru, если подключён)
  try {
    const fc = await factcheckPost(mdx, { minUnique: CONFIG.textru.minUnique, checkUnique: readiness().uniqueness });
    if (!fc.pass) { await notify(`🚫 Не прошло проверку: ${escapeHtml((fc.issues || []).join('; ') || 'фактчек')}. Тема не опубликована.`); return; }
  } catch (e) { await notify(`⚠️ Ошибка проверки уникальности: ${escapeHtml(e.message)}. Тема не опубликована.`); return; }

  // 3) Запись страницы
  try {
    writeBlogPost(slug, mdx);
    saveUsedQueries([...loadUsedQueries(), keyword]);
    updateLlmsTxt();
  } catch (e) { await notify(`⚠️ Не смог записать страницу: ${escapeHtml(e.message)}`); return; }

  // 4) Сборка + деплой
  const PY = process.platform === 'win32' ? 'python' : 'python3';
  const build = runStep('npm run build');
  if (!build.ok) {
    const tail = build.out.split('\n').filter(Boolean).slice(-6).join('\n').slice(0, 500);
    await notify(`🛑 Страница создана, но СБОРКА упала — сайт не обновлён.\n<code>${escapeHtml(tail)}</code>`);
    return;
  }
  const deploy = runStep(`${PY} scripts/deploy-ftp.py`);
  if (!deploy.ok) {
    const tail = deploy.out.split('\n').filter(Boolean).slice(-4).join('\n').slice(0, 400);
    await notify(`🛑 Сборка ок, но ДЕПЛОЙ упал.\n<code>${escapeHtml(tail)}</code>`);
    return;
  }

  // 5) Переиндексация
  const url = `${CONFIG.siteUrl}${targetUrlBase()}${slug}/`;
  try { await indexNowPing([CONFIG.siteUrl + '/', url]); } catch {}
  try { await recrawl(url); } catch {}

  await notify(`✅ <b>Опубликовано:</b> ${escapeHtml(url)}\nОтправил на переиндексацию в Яндекс. Появится в поиске в ближайшие дни.`);
}

main().catch((e) => notify(`⚠️ Непредвиденная ошибка: ${escapeHtml(e.message)}`));
