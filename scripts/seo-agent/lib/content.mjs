// Работа с контентом: учёт покрытых тем, пул внутренних ссылок, слаги, запись MDX.
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { ROOT_DIR } from '../config.mjs';

const SERVICES_DIR = resolve(ROOT_DIR, 'src/content/services');
const BLOG_DIR = resolve(ROOT_DIR, 'src/content/blog');
const DATA_DIR = resolve(ROOT_DIR, 'scripts/seo-agent/data');
const USED_FILE = join(DATA_DIR, 'used-queries.json');
const QUEUE_DIR = join(DATA_DIR, 'queue');

/** Очередь готовых статей (батч): отсортированные файлы q-NNNN-slug.mdx */
export function queuePath() {
  mkdirSync(QUEUE_DIR, { recursive: true });
  return QUEUE_DIR;
}
export function queueList() {
  if (!existsSync(QUEUE_DIR)) return [];
  return readdirSync(QUEUE_DIR).filter((f) => /\.mdx?$/.test(f)).sort().map((f) => join(QUEUE_DIR, f));
}
export function queueCount() {
  return queueList().length;
}
export function queuedSlugs() {
  return queueList().map((p) => p.replace(/.*[\\/]q-\d+-/, '').replace(/\.mdx?$/, ''));
}

function listMdx(dir, base) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (d, prefix) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name), `${prefix}${e.name}/`);
      else if (/\.mdx?$/.test(e.name)) {
        const slug = prefix + e.name.replace(/\.mdx?$/, '');
        const raw = readFileSync(join(d, e.name), 'utf-8');
        const fm = raw.match(/^---\n([\s\S]*?)\n---/);
        const block = fm ? fm[1] : '';
        const title = (block.match(/^title:\s*(.+)$/m)?.[1] || slug).replace(/^["']|["']$/g, '').trim();
        const kw = [];
        const kwm = block.match(/keywords:\n((?:\s*-\s*.+\n?)+)/);
        if (kwm) for (const l of kwm[1].split('\n')) { const m = l.match(/-\s*(.+)/); if (m) kw.push(m[1].trim()); }
        out.push({ slug, title, keywords: kw, url: `${base}${slug}/`, type: base.includes('blog') ? 'blog' : 'service' });
      }
    }
  };
  walk(dir, '');
  return out;
}

/** Все существующие страницы (услуги + блог) — для покрытия и перелинковки. */
export function existingPages() {
  return [...listMdx(SERVICES_DIR, '/uslugi/'), ...listMdx(BLOG_DIR, '/blog/')];
}

/** Пул внутренних ссылок для генератора (услуги + последние статьи). */
export function internalLinkPool() {
  return existingPages().map((p) => ({ title: p.title, url: p.url, type: p.type }));
}

export function loadUsedQueries() {
  if (!existsSync(USED_FILE)) return [];
  try { return JSON.parse(readFileSync(USED_FILE, 'utf-8')); } catch { return []; }
}
export function saveUsedQueries(arr) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(USED_FILE, JSON.stringify([...new Set(arr)], null, 2), 'utf-8');
}

const TRANSLIT = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',
  р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
};
export function slugify(text) {
  return text.toLowerCase().split('').map((c) => TRANSLIT[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
}

/** Записать статью блога в src/content/blog/<slug>.mdx */
export function writeBlogPost(slug, mdx) {
  mkdirSync(BLOG_DIR, { recursive: true });
  const path = join(BLOG_DIR, `${slug}.mdx`);
  writeFileSync(path, mdx, 'utf-8');
  return path;
}

export function blogPostExists(slug) {
  return existsSync(join(BLOG_DIR, `${slug}.mdx`));
}

/** Обновить раздел «Статьи блога» в public/llms.txt актуальным списком (для GEO). */
export function updateLlmsTxt() {
  const path = resolve(ROOT_DIR, 'public/llms.txt');
  if (!existsSync(path)) return false;
  let txt = readFileSync(path, 'utf-8');
  const posts = listMdx(BLOG_DIR, '/blog/');
  const section =
    '## Статьи блога\n\n' + posts.map((p) => `- ${p.title}: ${p.url}`).join('\n') + '\n';
  // удалить старый раздел, если был
  txt = txt.replace(/\n## Статьи блога\n[\s\S]*?(?=\n## |$)/, '\n');
  // вставить перед «## Контакты», иначе в конец
  if (txt.includes('## Контакты')) {
    txt = txt.replace('## Контакты', section + '\n## Контакты');
  } else {
    txt = txt.trimEnd() + '\n\n' + section;
  }
  writeFileSync(path, txt, 'utf-8');
  return true;
}
