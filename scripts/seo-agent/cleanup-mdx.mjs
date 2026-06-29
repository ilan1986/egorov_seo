// Прогнать sanitizeMdx по всем статьям/услугам (убрать залётные import/JSX, экранировать < >).
// Запуск: node scripts/seo-agent/cleanup-mdx.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR } from './config.mjs';
import { sanitizeMdx } from './lib/generate-post.mjs';

/** Починить «съеденный» моделью HTML: factbox-врезки и заголовки-якоря. */
function repairHtml(mdx) {
  const m = mdx.match(/^(---\n[\s\S]*?\n---\n)([\s\S]*)$/);
  const head = m ? m[1] : '';
  let body = m ? m[2] : mdx;
  body = body.replace(/^aside class="factbox"\s*$/gm, '<aside class="factbox">');
  body = body.replace(/^\/aside\s*$/gm, '</aside>');
  body = body.replace(/^h[1-6] id="([^"]+)"\s*$/gm, '<span id="$1"></span>');
  return head + body;
}

const walk = (d) => {
  let o = [];
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) o = o.concat(walk(p));
    else if (/\.mdx?$/.test(e.name)) o.push(p);
  }
  return o;
};

let fixed = 0, total = 0;
for (const dir of ['src/content/blog', 'src/content/services']) {
  for (const f of walk(join(ROOT_DIR, dir))) {
    total++;
    const raw = readFileSync(f, 'utf-8');
    const clean = sanitizeMdx(repairHtml(raw));
    if (clean !== raw) {
      writeFileSync(f, clean, 'utf-8');
      fixed++;
      console.log('очищен:', f.replace(/.*content./, ''));
    }
  }
}
console.log(`Проверено ${total}, очищено ${fixed}`);
