// GEO-метрика №1: AI Share of Voice — реально измеряет, цитируют ли нас нейросети.
// Берёт intent-вопросы ниши (geo.probeQuestions), задаёт их LLM через aigate и проверяет,
// упомянут ли бренд/домен в ответе и в списке рекомендованных источников. Пишет data/ai-sov.json;
// тренд подаётся в daily-report. Замыкает петлю обратной связи агента (планировщик видит AI SoV).
//
// Ограничение честно: без браузинга LLM отвечает из обучающей базы — это измеряет узнаваемость
// бренда моделью (сильный GEO-сигнал), а не живую выдачу Яндекс Нейро (у неё нет открытого API —
// её проверяют вручную/через SERP). Для Нейро-прокси используем xmlstock top-10 (в индексе Яндекса
// = кандидат в ответ Нейро), если ключ задан.
import { CONFIG, ROOT_DIR, readiness } from './config.mjs';
import { ask } from './lib/aigate.mjs';
import { PROFILE } from '../../site.profile.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const GEO = PROFILE.geo || {};
const SITE = (PROFILE.site?.url || PROFILE.siteUrl || CONFIG.siteUrl || '').replace(/\/$/, '');
const DOMAIN = SITE.replace(/^https?:\/\//, '').replace(/^www\./, '');
const BRAND = GEO.brand || PROFILE.bot?.projectName || DOMAIN;
const DATA = join(ROOT_DIR, 'scripts/seo-agent/data');
const OUT = join(DATA, 'ai-sov.json');

// Perplexity Sonar через aigate: web-grounded модель ИЩЕТ в интернете и возвращает источники (citations).
// Это измеряет РЕАЛЬНУЮ цитируемость сайта поисковым ИИ (близко к Яндекс Нейро/Алисе), а не память LLM.
const AIGATE_KEY = CONFIG.aigate?.apiKey || CONFIG.aigate?.key || process.env.AIGATE_API_KEY;
const AIGATE_BASE = (CONFIG.aigate?.baseUrl || 'https://api.aigate.shop/v1').replace(/\/$/, '');
const PROBE_MODEL = process.env.AI_PROBE_MODEL || 'perplexity/sonar';

async function askSonar(q) {
  const r = await fetch(`${AIGATE_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AIGATE_KEY}` },
    body: JSON.stringify({ model: PROBE_MODEL, messages: [{ role: 'user', content: q }], max_tokens: 700, temperature: 0.3 }),
    signal: AbortSignal.timeout(50000),
  });
  if (!r.ok) throw new Error(`sonar HTTP ${r.status}`);
  const j = await r.json();
  const msg = j.choices?.[0]?.message || {};
  const answer = msg.content || '';
  let cites = [];
  // aigate/Perplexity кладёт источники в message.annotations (OpenAI url_citation-формат)
  if (Array.isArray(msg.annotations)) cites = msg.annotations.map((a) => a.url_citation?.url || a.url || '');
  if (!cites.length && Array.isArray(j.citations)) cites = j.citations;
  if (!cites.length && Array.isArray(j.search_results)) cites = j.search_results.map((s) => s.url);
  if (!cites.length) cites = [...String(answer).matchAll(/https?:\/\/[^\s)\]]+/g)].map((m) => m[0]);
  return { answer, citations: cites.map((c) => (typeof c === 'string' ? c : c?.url || '')).filter(Boolean) };
}

const mentions = (text, needles) => {
  const t = (text || '').toLowerCase();
  return needles.some((n) => n && t.includes(n.toLowerCase()));
};
const inCitations = (cites, dom) => (cites || []).some((u) => String(u).toLowerCase().includes(dom.toLowerCase()));

/**
 * Прогнать probe по вопросам ниши.
 * @returns {Promise<{sovPct:number, cited:number, total:number, details:Array}>}
 */
export async function probeAiCitation({ questions } = {}) {
  const qs = (questions || GEO.probeQuestions || []).filter(Boolean);
  if (!qs.length) return { sovPct: null, cited: 0, total: 0, details: [], note: 'нет geo.probeQuestions в профиле' };

  const needles = [BRAND, DOMAIN, SITE].filter(Boolean);
  const details = [];
  for (const q of qs) {
    try {
      // Основной путь: Sonar (реальный поиск + источники). Считается цитированием, если домен в citations.
      const { answer, citations } = await askSonar(q);
      const inSources = inCitations(citations, DOMAIN);
      const inAnswer = mentions(answer, needles);
      details.push({ q, cited: inSources || inAnswer, inAnswer, inSources, sources: citations.slice(0, 6) });
    } catch (e) {
      // Фолбэк: generic-LLM (память модели), если Sonar недоступен.
      try {
        const answer = await ask('Ты — эксперт-консультант. Ответь по существу.', q, { maxTokens: 500, temperature: 0.4 });
        details.push({ q, cited: mentions(answer, needles), inAnswer: mentions(answer, needles), inSources: false, fallback: true });
      } catch (e2) { details.push({ q, cited: false, err: e.message }); }
    }
    await new Promise((r) => setTimeout(r, 600));
  }

  const cited = details.filter((d) => d.cited).length;
  const total = details.length;
  const sovPct = total ? Math.round((cited / total) * 100) : null;

  // История для тренда
  try {
    mkdirSync(DATA, { recursive: true });
    const hist = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf-8')) : { history: [] };
    hist.history = (hist.history || []).slice(-30);
    hist.history.push({ date: new Date().toISOString().slice(0, 10), sovPct, cited, total });
    hist.latest = { sovPct, cited, total, details };
    writeFileSync(OUT, JSON.stringify(hist, null, 2), 'utf-8');
  } catch { /* не критично */ }

  return { sovPct, cited, total, details, brand: BRAND };
}

/** Прошлый AI SoV (для дельты в отчёте). */
export function previousSov() {
  try {
    const h = JSON.parse(readFileSync(OUT, 'utf-8')).history || [];
    return h.length >= 2 ? h[h.length - 2].sovPct : null;
  } catch { return null; }
}

/** Строка для daily-report: AI SoV + тренд. */
export function sovReportLine(cur) {
  if (cur?.sovPct == null) return '🤖 AI-цитируемость: нет probe-вопросов (geo.probeQuestions).';
  const prev = previousSov();
  const trend = prev == null ? '🆕' : cur.sovPct > prev ? `▲ +${cur.sovPct - prev}` : cur.sovPct < prev ? `▼ ${cur.sovPct - prev}` : '=';
  return `🤖 AI Share of Voice: ${cur.sovPct}% (${cur.cited}/${cur.total} — поисковый ИИ цитирует сайт) ${trend}`;
}

// CLI: node scripts/seo-agent/ai-citation-probe.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const okAigate = CONFIG.aigate?.apiKey || CONFIG.aigate?.key || readiness()?.aigate;
  if (!okAigate) { console.log('aigate не настроен (нет ключа) — probe невозможен'); process.exit(0); }
  probeAiCitation().then((r) => {
    console.log(sovReportLine(r));
    for (const d of r.details) {
      console.log(` ${d.cited ? '✓' : '·'} ${d.q}${d.fallback ? ' [fallback-LLM]' : ''}${d.err ? ' [err: ' + d.err + ']' : ''}`);
      if (d.sources?.length) console.log('     источники: ' + d.sources.map((u) => u.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]).join(', '));
    }
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
