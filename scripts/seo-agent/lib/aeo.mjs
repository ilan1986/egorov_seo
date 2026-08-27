// AEO (Answer Engine Optimization) — делает сайт цитируемым нейросетями (ChatGPT/Алиса/Gemini/Perplexity),
// а не только видимым в классическом поиске. По умолчанию встроен в мозг агента: он периодически
// аудитит сайт по AEO-чек-листу и добивает технический фундамент. Чек-лист выведён из разбора GPT
// (доступ AI-ботам, schema+сущности, автор-эксперт, answer-first/FAQ, первоисточники, свежесть, llms.txt).
import { CONFIG } from '../config.mjs';

export const AI_BOTS = ['OAI-SearchBot', 'ChatGPT-User', 'GPTBot', 'PerplexityBot', 'Google-Extended', 'ClaudeBot', 'YandexAdditional'];
const SCHEMA_TYPES = ['Organization', 'Person', 'Article', 'NewsArticle', 'FAQPage', 'BreadcrumbList', 'ItemList', 'Review', 'AggregateRating', 'LocalBusiness', 'MedicalBusiness', 'ApartmentComplex', 'Product', 'Service'];
const EMPTY_MARKERS = ['уточняется', 'уточняются', 'появится здесь', 'появятся здесь', 'скоро здесь', 'в разработке', 'coming soon'];

const fetchText = async (u) => {
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    return { ok: r.ok, status: r.status, text: await r.text() };
  } catch (e) { return { ok: false, status: 0, text: '', err: String(e.message || e).slice(0, 60) }; }
};

/** Разрешающий блок robots.txt для AI-поисковиков (присутствие в ответах ChatGPT Search и др.). */
export function robotsAiDirectives() {
  return AI_BOTS.map((b) => `User-agent: ${b}\nAllow: /`).join('\n\n');
}

/** Стартовый llms.txt из профиля сайта (кто мы, эксперт, ключевые разделы) — для ИИ-краулеров. */
export function llmsTxt(profile = {}) {
  const name = profile.brand?.name || profile.siteName || CONFIG.siteUrl.replace(/^https?:\/\//, '');
  const about = profile.brand?.about || profile.description || '';
  const expert = profile.expert?.name ? `Эксперт: ${profile.expert.name}${profile.expert.role ? ` — ${profile.expert.role}` : ''}.` : '';
  return `# ${name}\n\n> ${about}\n\n${expert}\n\nОсновные разделы:\n${(profile.sections || []).map((s) => `- ${s}`).join('\n') || '- см. sitemap.xml'}\n\nКонтент можно цитировать со ссылкой на ${CONFIG.siteUrl}.\n`;
}

/** AEO-аудит одной страницы (по умолчанию — главная сайта). Возвращает {score, checks, schemaFound, gaps}. */
export async function aeoAudit(siteUrl = CONFIG.siteUrl) {
  const base = siteUrl.replace(/\/$/, '');
  const [home, robots, llms] = await Promise.all([fetchText(base), fetchText(base + '/robots.txt'), fetchText(base + '/llms.txt')]);
  const html = home.text || '';
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join(' ');
  const schemaFound = SCHEMA_TYPES.filter((t) => new RegExp(`"@type"\\s*:\\s*("|\\[)[^\\]]*${t}`, 'i').test(ld));
  const emptyBlocks = EMPTY_MARKERS.filter((m) => html.toLowerCase().includes(m));
  const aiBlocked = AI_BOTS.filter((b) => {
    const block = (robots.text || '').match(new RegExp(`User-agent:\\s*${b}[\\s\\S]*?(?=User-agent:|$)`, 'i'))?.[0] || '';
    return /Disallow:\s*\/\s*(\n|$)/i.test(block);
  });

  const has = (t) => schemaFound.includes(t);
  const checks = {
    ai_bots: robots.ok ? (aiBlocked.length ? `закрыты: ${aiBlocked.join(',')}` : 'ок') : 'нет robots.txt',
    llms_txt: llms.ok && llms.text.trim() ? 'есть' : 'нет',
    schema: schemaFound.length ? schemaFound.join(', ') : 'нет',
    author: has('Person') ? 'ок' : 'нет Person',
    faq: has('FAQPage') ? 'ок' : (/частые вопросы|F\.?A\.?Q/i.test(html) ? 'FAQ без schema' : 'нет'),
    freshness: /"dateModified"/i.test(ld) ? 'ок' : 'нет dateModified',
    empty: emptyBlocks.length ? `${emptyBlocks.length} пустых блоков` : 'ок',
  };
  const gaps = [];
  if (aiBlocked.length) gaps.push('открыть AI-ботов в robots');
  if (checks.llms_txt === 'нет') gaps.push('добавить llms.txt');
  if (!has('Person')) gaps.push('Person-схема эксперта');
  if (checks.faq !== 'ок') gaps.push('FAQPage-разметка');
  if (checks.freshness !== 'ок') gaps.push('dateModified в schema');
  if (emptyBlocks.length) gaps.push('убрать пустые шаблонные блоки');

  let score = home.ok ? 10 : 0;
  score += Math.min(24, schemaFound.length * 4);
  if (has('Person')) score += 14;
  if (checks.faq === 'ок') score += 12; else if (checks.faq === 'FAQ без schema') score += 6;
  if (checks.freshness === 'ок') score += 8;
  if (!aiBlocked.length) score += 12;
  if (checks.llms_txt === 'есть') score += 8;
  if (!emptyBlocks.length) score += 12;
  return { url: base, score: Math.min(100, score), schemaFound, checks, gaps, reachable: home.ok };
}

/** Короткая строка для отчёта/лога. */
export function aeoLine(r) {
  return `🤖 AEO ${r.score}/100 — ${r.gaps.length ? 'добить: ' + r.gaps.join(', ') : 'фундамент закрыт'}`;
}

// CLI: node scripts/seo-agent/lib/aeo.mjs
import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  aeoAudit().then((r) => { console.log(JSON.stringify(r.checks, null, 1)); console.log(aeoLine(r)); }).catch((e) => { console.error(e.message); process.exit(1); });
}
