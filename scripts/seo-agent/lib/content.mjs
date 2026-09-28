// Работа с контентом: учёт покрытых тем, пул внутренних ссылок, слаги, запись MDX.
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { ROOT_DIR } from '../config.mjs';
import { PROFILE } from '../../../site.profile.mjs';

// Все MDX-коллекции сайта (site.profile.mjs) — см. пример в site.profile.example.mjs.
const COLLECTIONS = PROFILE.content.collections.map((c) => ({ ...c, absDir: resolve(ROOT_DIR, c.dir) }));
const TARGET = COLLECTIONS.find((c) => c.isTarget);
if (!TARGET) throw new Error('site.profile.mjs: ни одна content.collections не помечена isTarget: true');

// Каталоги-справочники не на MDX (напр. карточки ЖК/застройщиков — JSON): дают ссылки,
// но не участвуют в дедупе тем (у них нет keywords). Опционально в site.profile.mjs.
const LINK_CATALOGS = (PROFILE.content.linkCatalogs || []).map((c) => ({ ...c, absDir: resolve(ROOT_DIR, c.dir) }));

/** Список всех директорий контента (для cleanup-mdx/expand-existing). */
export function contentDirs() {
  return COLLECTIONS.map((c) => c.absDir);
}

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
  return queueList().map((p) => p.replace(/.*[\\/]q-(?:[a-z]+-)?\d+-/, '').replace(/\.mdx?$/, '')); // q-ch-<id>- тоже
}

function listMdx(dir, base, type) {
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
        out.push({ slug, title, keywords: kw, url: `${base}${slug}/`, type });
      }
    }
  };
  walk(dir, '');
  return out;
}

/** Все существующие страницы всех коллекций сайта — для покрытия и перелинковки. */
export function existingPages() {
  return COLLECTIONS.flatMap((c) => listMdx(c.absDir, c.urlBase, c.name));
}

/** Карточки JSON-справочников (напр. ЖК/застройщики) — только для пула ссылок, не для дедупа тем. */
function listJsonCatalog(dir, base, type, titleField) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    const slug = f.replace(/\.json$/, '');
    let title = slug;
    try { title = JSON.parse(readFileSync(join(dir, f), 'utf-8'))[titleField] || slug; } catch { /* пропускаем битый файл */ }
    return { title, url: `${base}${slug}/`, type };
  });
}

/** Пул внутренних ссылок для генератора: MDX-коллекции + JSON-справочники (если заданы). */
export function internalLinkPool() {
  const mdxLinks = existingPages().map((p) => ({ title: p.title, url: p.url, type: p.type }));
  const catalogLinks = LINK_CATALOGS.flatMap((c) => listJsonCatalog(c.absDir, c.urlBase, c.name, c.titleField || 'name'));
  return [...mdxLinks, ...catalogLinks];
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

/** Записать сгенерированную статью в целевую коллекцию (site.profile.mjs → content.collections[isTarget]).
 *  slug может содержать «/» (вложенная структура, напр. city/niche/slug) — поддиректории создаются сами. */
/** urlBase целевой (isTarget) коллекции — для построения ссылок на публикуемые статьи. */
export function targetUrlBase() {
  return TARGET.urlBase;
}

export function writeBlogPost(slug, mdx) {
  const path = join(TARGET.absDir, `${slug}.mdx`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, mdx, 'utf-8');
  return path;
}

export function blogPostExists(slug) {
  return existsSync(join(TARGET.absDir, `${slug}.mdx`));
}

/** Нормализовать любой URL/путь к «/urlBase/slug/». */
export function urlPath(u) {
  let p = String(u || '').trim();
  p = p.replace(/^https?:\/\/[^/]+/i, ''); // убрать домен
  p = p.split(/[?#]/)[0];                  // убрать query/anchor
  if (!p.startsWith('/')) p = '/' + p;
  if (!p.endsWith('/')) p += '/';
  return p;
}

/** Найти MDX-файл, соответствующий URL страницы сайта (любая коллекция профиля). null — если не наш. */
export function fileForUrl(u) {
  const p = urlPath(u);
  for (const c of COLLECTIONS) {
    if (!p.startsWith(c.urlBase)) continue;
    const slug = p.slice(c.urlBase.length).replace(/\/$/, '');
    if (!slug) continue;
    for (const ext of ['.mdx', '.md']) {
      const path = join(c.absDir, slug + ext);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

/** Текущие мета-поля из frontmatter файла. */
export function readMeta(path) {
  const raw = readFileSync(path, 'utf-8');
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  const block = fm ? fm[1] : '';
  const clean = (s) => (s || '').replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim();
  const seoTitle = clean(block.match(/^seoTitle:\s*(.+)$/m)?.[1]);
  const title = clean(block.match(/^title:\s*(.+)$/m)?.[1]);
  // description может быть свёрнутым блоком (>- с отступами)
  let description = '';
  const dm = block.match(/^description:\s*(?:>-?|\|-?)?\s*\n((?:[ \t]+.*\n?)+)/m);
  if (dm) description = dm[1].split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
  else description = clean(block.match(/^description:\s*(.+)$/m)?.[1]);
  return { title, seoTitle, description };
}

/** Точечно переписать seoTitle/description/updated во frontmatter (не трогая тело и остальные поля). */
export function updateMeta(path, patch = {}) {
  const raw = readFileSync(path, 'utf-8');
  const fmMatch = raw.match(/^(---\n)([\s\S]*?)(\n---)/);
  if (!fmMatch) return false;
  let block = fmMatch[2];
  const setLine = (key, value) => {
    const line = `${key}: ${JSON.stringify(value)}`;
    // свёрнутый блок вида «key: >-\n  ...»
    const folded = new RegExp(`^${key}:\\s*(?:>-?|\\|-?)?\\s*\\n(?:[ \\t]+.*\\n?)+`, 'm');
    const single = new RegExp(`^${key}:.*$`, 'm');
    if (folded.test(block)) block = block.replace(folded, line + '\n');
    else if (single.test(block)) block = block.replace(single, line);
    else block = block.replace(/^(title:.*)$/m, `$1\n${line}`); // вставить после title
  };
  if (patch.seoTitle) setLine('seoTitle', patch.seoTitle);
  if (patch.description) setLine('description', patch.description);
  if (patch.updated) setLine('updated', patch.updated);
  const out = fmMatch[1] + block.replace(/\n+$/, '') + fmMatch[3] + raw.slice(fmMatch[0].length);
  writeFileSync(path, out, 'utf-8');
  return true;
}

/** Обновить раздел со списком сгенерированных статей в public/llms.txt (для GEO). */
export function updateLlmsTxt() {
  const path = resolve(ROOT_DIR, 'public/llms.txt');
  if (!existsSync(path)) return false;
  let txt = readFileSync(path, 'utf-8');
  const title = PROFILE.content.llmsSectionTitle;
  const posts = listMdx(TARGET.absDir, TARGET.urlBase, TARGET.name);
  const section = `${title}\n\n` + posts.map((p) => `- ${p.title}: ${p.url}`).join('\n') + '\n';
  // удалить старый раздел, если был
  const titleRe = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  txt = txt.replace(new RegExp(`\\n${titleRe}\\n[\\s\\S]*?(?=\\n## |$)`), '\n');
  // вставить перед «## Контакты», иначе в конец
  if (txt.includes('## Контакты')) {
    txt = txt.replace('## Контакты', section + '\n## Контакты');
  } else {
    txt = txt.trimEnd() + '\n\n' + section;
  }
  writeFileSync(path, txt, 'utf-8');
  return true;
}
