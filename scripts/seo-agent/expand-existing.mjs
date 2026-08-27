// Массовое расширение существующих страниц до ≥1500 слов тела.
// Фронтматтер сохраняется ДОСЛОВНО, расширяется только тело. Запуск: node scripts/seo-agent/expand-existing.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ROOT_DIR } from './config.mjs';
import { join } from 'node:path';
import { ask } from './lib/aigate.mjs';
import { sanitizeMdx } from './lib/generate-post.mjs';
import { internalLinkPool, contentDirs } from './lib/content.mjs';
import { PROFILE } from '../../site.profile.mjs';

const MIN = 1500;
const TARGET = 1850;
const wc = (b) => b.replace(/[#>*`\-|\[\]()]/g, ' ').split(/\s+/).filter(Boolean).length;
const split = (mdx) => {
  const m = mdx.match(/^(---\n[\s\S]*?\n---\n)([\s\S]*)$/);
  return m ? { fm: m[1], body: m[2] } : { fm: '', body: mdx };
};
const titleOf = (fm) => (fm.match(/^title:\s*(.+)$/m)?.[1] || '').replace(/^["']|["']$/g, '').trim();
const strip = (s) => s.replace(/^```(mdx|markdown)?\n?/i, '').replace(/\n?```$/i, '').trim();

const walk = (d) => {
  let o = [];
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) o = o.concat(walk(p));
    else if (/\.mdx?$/.test(e.name)) o.push(p);
  }
  return o;
};

const pool = internalLinkPool();
const links = pool.map((l) => `- ${l.title}: ${l.url}`).join('\n');
// Приоритет — очередь тонких из quality-gates (data/enrichment-queue.json): работаем список задач.
const LIMIT = Number(process.env.EXPAND_LIMIT || 6);
let files;
try {
  const q = JSON.parse(readFileSync(join(ROOT_DIR, 'scripts/seo-agent/data/enrichment-queue.json'), 'utf-8'));
  if (Array.isArray(q.articles) && q.articles.length) {
    files = q.articles.map((a) => a.file).filter((f) => { try { return existsSync(f); } catch { return false; } });
    console.log(`[expand] очередь на обогащение: ${files.length} тонких статей (лимит ${LIMIT}/прогон)`);
  }
} catch { /* нет очереди — расширяем всё */ }
if (!files) files = contentDirs().flatMap(walk);
files = files.slice(0, LIMIT);

let expanded = 0, skipped = 0;
for (const f of files) {
  const raw = readFileSync(f, 'utf-8');
  const { fm, body } = split(raw);
  const n0 = wc(body);
  if (n0 >= MIN) { console.log(`= ок (${n0}): ${f.replace(/.*content./, '')}`); skipped++; continue; }
  const t = titleOf(fm);

  let newBody = body;
  for (let pass = 0; pass < 3 && wc(newBody) < MIN + 80; pass++) {
    const prompt =
      `Это ТЕЛО страницы «${t}» (без фронтматтера). Расширь его до НЕ МЕНЕЕ ${TARGET} слов живым ` +
      `экспертным языком от лица ${PROFILE.generation.expertPersonaShort}: добавь разделы H2/H3, конкретные ` +
      `примеры с цифрами, частые ошибки, разбор по ситуациям${PROFILE.generation.authoritySourcesHint ? `, ${PROFILE.generation.authoritySourcesHint}` : ''}. ` +
      `СОХРАНИ имеющуюся разметку (factbox, таблицы, ссылки) и добавь минимум 3 внутренние ` +
      `ссылки из списка. БЕЗ клише и «воды». Разметка — Markdown; единственный HTML — врезка <aside class="factbox">…</aside>; ` +
      `НЕ добавляй import/export и JSX-компоненты; знаки сравнения пиши словами (менее/более). ` +
      `Верни ТОЛЬКО тело в MDX (без фронтматтера, без тройных кавычек).\n\n` +
      `Внутренние ссылки:\n${links}\n\nТекущее тело:\n${newBody}`;
    try {
      newBody = strip(await ask(PROFILE.generation.systemPrompt, prompt, { maxTokens: 9000, temperature: 0.6 }));
    } catch (e) { console.log(`  ! ошибка пасса: ${e.message}`); break; }
  }

  const outMdx = sanitizeMdx(fm + (fm && !fm.endsWith('\n') ? '\n' : '') + newBody + '\n');
  const n1 = wc(split(outMdx).body);
  if (n1 < MIN) { console.log(`  ⚠ не добил (${n0}→${n1}), оставляю как есть: ${f.replace(/.*content./, '')}`); continue; }
  writeFileSync(f, outMdx, 'utf-8');
  expanded++;
  console.log(`+ ${n0} → ${n1}: ${f.replace(/.*content./, '')}`);
}
console.log(`\nГотово. Расширено: ${expanded}, уже ок: ${skipped}.`);
