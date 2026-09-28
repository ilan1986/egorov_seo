// Публикатор для Joomla 4/5 через встроенный Web Services REST API (com_content).
// Включается в site.profile.mjs → publish: { type: 'joomla', ... }. Ядро вызывает publishToJoomla()
// вместо записи MDX-файла (см. lib/publish.mjs). Требует на стороне Joomla:
//   • включённый плагин «API Authentication - Token» + токен пользователя (Bearer);
//   • включённый плагин «Web Services - Content»;
//   • пользователя с правом создавать статьи в целевой категории.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/* ─────────────── markdown → HTML (без внешних зависимостей) ─────────────── */
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function inline(s) {
  return esc(s)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => `<a href="${u}">${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
export function mdToHtml(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const flushList = (buf, ordered) => { if (buf.length) out.push(`<${ordered ? 'ol' : 'ul'}>${buf.map((x) => `<li>${inline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`); };
  while (i < lines.length) {
    let ln = lines[i];
    if (!ln.trim()) { i++; continue; }
    // заголовки
    const h = ln.match(/^(#{1,6})\s+(.*)$/);
    if (h) { const lvl = h[1].length; out.push(`<h${lvl}>${inline(h[2].trim())}</h${lvl}>`); i++; continue; }
    // hr
    if (/^\s*---+\s*$/.test(ln)) { out.push('<hr>'); i++; continue; }
    // таблица
    if (ln.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const parseRow = (r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const head = parseRow(ln); i += 2; const rows = [];
      while (i < lines.length && lines[i].includes('|')) { rows.push(parseRow(lines[i])); i++; }
      out.push('<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    // списки
    if (/^\s*[-*]\s+/.test(ln)) { const buf = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; } flushList(buf, false); continue; }
    if (/^\s*\d+\.\s+/.test(ln)) { const buf = []; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; } flushList(buf, true); continue; }
    // абзац (склеиваем до пустой строки)
    const par = [ln]; i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*[-*]\s|\s*\d+\.\s|\s*---+\s*$)/.test(lines[i]) && !lines[i].includes('|')) { par.push(lines[i]); i++; }
    out.push(`<p>${inline(par.join(' '))}</p>`);
  }
  return out.join('\n');
}

/* ─────────────── разбор MDX (frontmatter + тело) ─────────────── */
export function parsePost(mdx, slug) {
  const fm = mdx.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const block = fm ? fm[1] : '';
  const body = fm ? fm[2] : mdx;
  const one = (k) => (block.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1] || '').replace(/^["']|["']$/g, '').trim();
  const list = (k) => {
    const m = block.match(new RegExp(`^${k}:\\n((?:\\s*-\\s*.+\\n?)+)`, 'm'));
    return m ? m[1].split('\n').map((l) => l.match(/-\s*(.+)/)?.[1]?.replace(/^["']|["']$/g, '').trim()).filter(Boolean) : [];
  };
  // faq: пары q/a (построчно — надёжнее жадного regex, faq может быть последним ключом)
  const faq = [];
  let inFaq = false, curQ = null;
  for (const l of block.split('\n')) {
    if (/^faq:\s*$/.test(l)) { inFaq = true; continue; }
    if (inFaq && /^[A-Za-z]\w*:/.test(l)) break; // следующий top-level ключ frontmatter
    if (!inFaq) continue;
    const q = l.match(/^\s*-\s*q:\s*(.+)$/);
    if (q) { curQ = q[1].replace(/^["']|["']$/g, '').trim(); continue; }
    const a = l.match(/^\s*a:\s*(.+)$/);
    if (a && curQ) { faq.push({ q: curQ, a: a[1].replace(/^["']|["']$/g, '').trim() }); curQ = null; }
  }
  return {
    slug, title: one('title'), description: one('description'), seoTitle: one('seoTitle') || one('title'),
    image: one('image'), category: one('category'), keywords: list('keywords'), tldr: list('tldr'), faq, body,
  };
}

/* ─────────────── сборка HTML статьи для Joomla (тело + FAQ + JSON-LD) ─────────────── */
export function buildArticleHtml(post, cfg = {}) {
  const parts = [];
  if (post.tldr?.length) parts.push('<div class="tldr"><strong>Кратко:</strong><ul>' + post.tldr.map((t) => `<li>${esc(t)}</li>`).join('') + '</ul></div>');
  parts.push(mdToHtml(post.body));
  if (post.faq?.length) parts.push('<h2>Частые вопросы</h2>' + post.faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join(''));
  // JSON-LD (Article + FAQPage) для GEO
  const graph = [{
    '@type': 'Article', headline: post.seoTitle || post.title, description: post.description,
    ...(cfg.authorAlias ? { author: { '@type': 'Person', name: cfg.authorAlias } } : {}),
    ...(cfg.baseUrl ? { publisher: { '@type': 'Organization', name: cfg.orgName || cfg.baseUrl } } : {}),
  }];
  if (post.faq?.length) graph.push({ '@type': 'FAQPage', mainEntity: post.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
  parts.push(`<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>`);
  return parts.join('\n');
}

/* ─────────────── HTTP к Joomla API ─────────────── */
function api(cfg, path) { return `${cfg.baseUrl.replace(/\/$/, '')}/api/index.php/v1/${path.replace(/^\//, '')}`; }
function token(cfg) {
  const t = cfg.token || (cfg.tokenEnv && process.env[cfg.tokenEnv]);
  if (!t) throw new Error(`Joomla: нет токена (задай env ${cfg.tokenEnv || 'JOOMLA_TOKEN'} или publish.token)`);
  return t;
}
async function jfetch(cfg, path, { method = 'GET', body } = {}) {
  const res = await fetch(api(cfg, path), {
    method,
    headers: { Authorization: `Bearer ${token(cfg)}`, 'Content-Type': 'application/json', Accept: 'application/vnd.api+json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) throw new Error(`Joomla ${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return json;
}

/** Проверка соединения: токен валиден, Web Services включены. */
export async function testJoomlaConnection(cfg) {
  try {
    const j = await jfetch(cfg, 'content/articles?page[limit]=1');
    return { ok: true, articles: Array.isArray(j?.data) ? j.data.length : 0 };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

/** Загрузить обложку в медиатеку Joomla, вернуть относительный путь для images. */
export async function uploadImage(cfg, localPath) {
  if (!cfg.mediaDir) return null;
  const name = basename(localPath);
  const content = readFileSync(localPath).toString('base64');
  const path = `${cfg.mediaDir.replace(/\/$/, '')}/${name}`;
  await jfetch(cfg, `media/files/${path}`, { method: 'POST', body: { path, content } });
  return path; // напр. "images/articles/foo.jpg"
}

/** Опубликовать статью. Возвращает { id, url, alias }. */
export async function publishToJoomla(post, cfg) {
  const html = buildArticleHtml(post, cfg);
  const alias = post.slug.split('/').pop();
  // обложка (если задан mediaDir и есть локальный файл)
  let images;
  if (cfg.mediaDir && post.imageLocalPath) {
    try { const rel = await uploadImage(cfg, post.imageLocalPath); images = { image_intro: rel, image_fulltext: rel }; } catch { /* обложка не критична */ }
  }
  const payload = {
    title: post.title, alias,
    catid: cfg.catid,
    language: cfg.language || '*',
    state: cfg.state ?? 1,
    access: cfg.access ?? 1,
    featured: cfg.featured ?? 0,
    introtext: html,
    metadesc: post.description || '',
    metakey: (post.keywords || []).join(', '),
    ...(cfg.authorAlias ? { created_by_alias: cfg.authorAlias } : {}),
    ...(images ? { images: JSON.stringify(images) } : {}),
  };
  const j = await jfetch(cfg, 'content/articles', { method: 'POST', body: payload });
  const id = j?.data?.id;
  // публичный URL: SEF по шаблону из профиля, иначе не-SEF
  const url = cfg.urlPattern
    ? cfg.baseUrl.replace(/\/$/, '') + cfg.urlPattern.replace('{alias}', alias).replace('{id}', id)
    : `${cfg.baseUrl.replace(/\/$/, '')}/index.php?option=com_content&view=article&id=${id}`;
  return { id, url, alias };
}
