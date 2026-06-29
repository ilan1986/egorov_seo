// Массовое расширение существующих страниц до ≥1500 слов тела.
// Фронтматтер сохраняется ДОСЛОВНО, расширяется только тело. Запуск: node scripts/seo-agent/expand-existing.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR } from './config.mjs';
import { ask } from './lib/aigate.mjs';
import { sanitizeMdx } from './lib/generate-post.mjs';
import { internalLinkPool } from './lib/content.mjs';

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
const files = [join(ROOT_DIR, 'src/content/blog'), join(ROOT_DIR, 'src/content/services')].flatMap(walk);

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
      `экспертным языком от лица бухгалтера-аудитора: добавь разделы H2/H3, конкретные примеры с цифрами, ` +
      `частые ошибки, разбор по ситуациям, ссылки на статьи НК РФ и хотя бы 1 внешнюю ссылку на nalog.gov.ru ` +
      `или consultant.ru. СОХРАНИ имеющуюся разметку (factbox, таблицы, ссылки) и добавь минимум 3 внутренние ` +
      `ссылки из списка. БЕЗ клише и «воды». Разметка — Markdown; единственный HTML — врезка <aside class="factbox">…</aside>; ` +
      `НЕ добавляй import/export и JSX-компоненты; знаки сравнения пиши словами (менее/более). ` +
      `Верни ТОЛЬКО тело в MDX (без фронтматтера, без тройных кавычек).\n\n` +
      `Внутренние ссылки:\n${links}\n\nТекущее тело:\n${newBody}`;
    try {
      newBody = strip(await ask('Ты эксперт-редактор по налогам и бухгалтерии РФ.', prompt, { maxTokens: 9000, temperature: 0.6 }));
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
