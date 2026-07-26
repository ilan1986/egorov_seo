// GEO schema-генератор: собирает один JSON-LD @graph для страницы статьи —
// Article/BlogPosting + Person(автор) + Organization + BreadcrumbList + FAQPage + speakable + ImageObject.
// Машинное доверие и распознавание сущности — сильнейший GEO-сигнал (sameAs/knowsAbout).
// Вставлять в Astro-layout server-side (set:html={JSON.stringify(buildArticleGraph(...))}), НЕ JS-инъекцией.
//
// Данные берутся из frontmatter статьи + раздела `geo` в site.profile.mjs (см. site.profile.example.mjs).
import { PROFILE } from '../../../site.profile.mjs';

const SITE = (PROFILE.site?.url || PROFILE.siteUrl || '').replace(/\/$/, '');
const GEO = PROFILE.geo || {};

const abs = (u) => (!u ? undefined : /^https?:/.test(u) ? u : `${SITE}${u.startsWith('/') ? '' : '/'}${u}`);

/** Извлечь FAQ (Q/A) из markdown-тела: секция «Частые вопросы» с **вопрос** + абзац-ответ. */
export function extractFaq(md) {
  const body = String(md).replace(/^---\n[\s\S]*?\n---\n/, '');
  const faqStart = body.search(/^#{2,3}\s+(частые вопросы|faq|вопросы и ответы)/im);
  const zone = faqStart >= 0 ? body.slice(faqStart) : body;
  const out = [];
  // паттерн: строка **Вопрос?** \n Ответ...
  const re = /(?:^|\n)\s*(?:\*\*|###\s+)([^*\n]{8,160}\?)(?:\*\*)?\s*\n+([^\n][^]*?)(?=\n\s*(?:\*\*[^*\n]{8,160}\?|###\s|##\s|$))/g;
  let m;
  while ((m = re.exec(zone)) && out.length < 12) {
    const q = m[1].replace(/[*#]/g, '').trim();
    const a = m[2].replace(/[*#>_`]/g, '').replace(/\s+/g, ' ').trim();
    if (q && a && a.length > 20) out.push({ q, a: a.slice(0, 600) });
  }
  return out;
}

function personNode() {
  const a = GEO.author || {};
  if (!a.name) return null;
  return {
    '@type': 'Person', '@id': `${SITE}/#author`,
    name: a.name,
    ...(a.jobTitle ? { jobTitle: a.jobTitle } : {}),
    ...(a.url ? { url: abs(a.url) } : { url: SITE }),
    ...(a.sameAs?.length ? { sameAs: a.sameAs } : {}),
    ...(a.knowsAbout?.length ? { knowsAbout: a.knowsAbout } : {}),
  };
}

function orgNode() {
  const o = GEO.organization || {};
  const name = o.name || GEO.brand || PROFILE.bot?.projectName;
  if (!name) return null;
  return {
    '@type': 'Organization', '@id': `${SITE}/#org`,
    name, url: SITE,
    ...(o.logo ? { logo: abs(o.logo) } : {}),
    ...(o.sameAs?.length ? { sameAs: o.sameAs } : {}),
    ...(o.knowsAbout?.length ? { knowsAbout: o.knowsAbout } : {}),
  };
}

/**
 * Собрать @graph для страницы статьи.
 * @param {object} p — { title, description, url, datePublished, dateModified, image, keyword, md }
 */
export function buildArticleGraph({ title, description, url, datePublished, dateModified, image, keyword, md }) {
  const pageUrl = abs(url);
  const iso = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
  const author = personNode();
  const org = orgNode();
  const graph = [];

  const article = {
    '@type': GEO.articleType || 'Article',
    '@id': `${pageUrl}#article`,
    headline: title,
    description,
    inLanguage: 'ru-RU',
    mainEntityOfPage: pageUrl,
    datePublished: iso(datePublished),
    dateModified: iso(dateModified || datePublished),
    ...(image ? { image: abs(image) } : {}),
    ...(keyword ? { keywords: keyword } : {}),
    ...(author ? { author: { '@id': author['@id'] } } : {}),
    ...(org ? { publisher: { '@id': org['@id'] } } : author ? { publisher: { '@id': author['@id'] } } : {}),
    // speakable — какие части страницы озвучивать голосовым ассистентам
    speakable: { '@type': 'SpeakableSpecification', cssSelector: ['h1', '.prose > p:first-of-type', '.prose h2'] },
  };
  graph.push(article);
  if (author) graph.push(author);
  if (org) graph.push(org);

  graph.push({
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Главная', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: GEO.blogName || 'Блог', item: `${SITE}${GEO.blogBase || '/blog/'}` },
      { '@type': 'ListItem', position: 3, name: title, item: pageUrl },
    ],
  });

  if (image) {
    const imgUrl = abs(image);
    article.image = { '@type': 'ImageObject', url: imgUrl, contentUrl: imgUrl };
    graph.push({ '@type': 'ImageObject', '@id': `${pageUrl}#primaryimage`, url: imgUrl, contentUrl: imgUrl });
  }

  const faq = md ? extractFaq(md) : [];
  if (faq.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${pageUrl}#faq`,
      mainEntity: faq.map((f) => ({
        '@type': 'Question', name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}

/**
 * Граф главной страницы: WebSite (+ SearchAction, если есть поиск) + Organization/Person.
 * Помогает нейросетям опознать сайт как сущность. Вставлять на index.astro.
 */
export function buildWebSiteGraph({ searchUrlTemplate } = {}) {
  const org = orgNode();
  const author = personNode();
  const graph = [{
    '@type': 'WebSite', '@id': `${SITE}/#website`,
    url: `${SITE}/`, name: GEO.brand || PROFILE.bot?.projectName || SITE, inLanguage: 'ru-RU',
    ...(org ? { publisher: { '@id': org['@id'] } } : {}),
    ...(searchUrlTemplate ? {
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${SITE}${searchUrlTemplate}` },
        'query-input': 'required name=search_term_string',
      },
    } : {}),
  }];
  if (org) graph.push(org);
  else if (author) graph.push(author);
  return { '@context': 'https://schema.org', '@graph': graph };
}
