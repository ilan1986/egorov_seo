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

// Мульти-движковый замер цитируемости через aigate. GEO-KPI: цитируют ли нас поисковые ИИ.
//  - perplexity (Sonar): web-grounded — реально ищет и возвращает источники (близко к Алисе/Нейро).
//  - gpt / gemini: без web-поиска (отвечают из обучения) — меряем УЗНАВАЕМОСТЬ бренда моделью.
// Яндекс Алиса меряется отдельно (нужен резидентный прокси; см. README) — тут её нет.
const AIGATE_KEY = CONFIG.aigate?.apiKey || CONFIG.aigate?.key || process.env.AIGATE_API_KEY;
const AIGATE_BASE = (CONFIG.aigate?.baseUrl || 'https://api.aigate.shop/v1').replace(/\/$/, '');

// Движки замера (переопределяемо через GEO.probeEngines в профиле или env AI_PROBE_ENGINES).
const DEFAULT_ENGINES = [
  { id: 'perplexity', model: 'perplexity/sonar', grounded: true },
  { id: 'gpt', model: process.env.AI_PROBE_GPT || 'openai/gpt-5.4', grounded: false },
  { id: 'gemini', model: process.env.AI_PROBE_GEMINI || 'google/gemini-3.6-flash', grounded: false },
];
const ENGINES = (GEO.probeEngines && GEO.probeEngines.length) ? GEO.probeEngines : DEFAULT_ENGINES;

async function askEngine(model, q) {
  const r = await fetch(`${AIGATE_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AIGATE_KEY}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: q }], max_tokens: 700, temperature: 0.3 }),
    signal: AbortSignal.timeout(50000),
  });
  if (!r.ok) throw new Error(`${model} HTTP ${r.status}`);
  const j = await r.json();
  const msg = j.choices?.[0]?.message || {};
  const answer = msg.content || '';
  let cites = [];
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
  if (!qs.length) return { sovPct: null, cited: 0, total: 0, details: [], engines: {}, note: 'нет geo.probeQuestions в профиле' };

  const needles = [BRAND, DOMAIN, SITE].filter(Boolean);
  const details = [];
  const engineStat = Object.fromEntries(ENGINES.map((e) => [e.id, { cited: 0, total: 0 }]));

  for (const q of qs) {
    const perEngine = {};
    for (const eng of ENGINES) {
      try {
        const { answer, citations } = await askEngine(eng.model, q);
        // grounded (Perplexity): цитирование = домен в источниках; иначе — упоминание бренда (узнаваемость).
        const inSources = eng.grounded ? inCitations(citations, DOMAIN) : false;
        const inAnswer = mentions(answer, needles);
        const cited = inSources || inAnswer;
        perEngine[eng.id] = { cited, inAnswer, inSources, sources: citations.slice(0, 5) };
        engineStat[eng.id].total++; if (cited) engineStat[eng.id].cited++;
      } catch (e) {
        perEngine[eng.id] = { cited: false, err: e.message };
        engineStat[eng.id].total++;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    // вопрос «закрыт», если цитирует ХОТЯ БЫ один движок
    details.push({ q, cited: Object.values(perEngine).some((x) => x.cited), engines: perEngine });
  }

  const total = details.length;
  const cited = details.filter((d) => d.cited).length;
  const sovPct = total ? Math.round((cited / total) * 100) : null;
  // SoV по каждому движку
  const engines = Object.fromEntries(Object.entries(engineStat).map(([k, v]) => [k, { pct: v.total ? Math.round((v.cited / v.total) * 100) : null, cited: v.cited, total: v.total }]));

  // История для тренда (общий + по движкам)
  try {
    mkdirSync(DATA, { recursive: true });
    const hist = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf-8')) : { history: [] };
    hist.history = (hist.history || []).slice(-30);
    hist.history.push({ date: new Date().toISOString().slice(0, 10), sovPct, cited, total, engines });
    hist.latest = { sovPct, cited, total, details, engines };
    writeFileSync(OUT, JSON.stringify(hist, null, 2), 'utf-8');
  } catch { /* не критично */ }

  return { sovPct, cited, total, details, engines, brand: BRAND };
}

/** Прошлый AI SoV (для дельты в отчёте). */
export function previousSov() {
  try {
    const h = JSON.parse(readFileSync(OUT, 'utf-8')).history || [];
    return h.length >= 2 ? h[h.length - 2].sovPct : null;
  } catch { return null; }
}

/** Строка для daily-report: AI SoV по движкам + тренд. GEO-KPI №1. */
export function sovReportLine(cur) {
  if (cur?.sovPct == null) return '🤖 AI-цитируемость: нет probe-вопросов (geo.probeQuestions).';
  const prev = previousSov();
  const trend = prev == null ? '🆕' : cur.sovPct > prev ? `▲ +${cur.sovPct - prev}` : cur.sovPct < prev ? `▼ ${cur.sovPct - prev}` : '=';
  const byEng = cur.engines
    ? '\n   ' + Object.entries(cur.engines).map(([k, v]) => `${k}: ${v.pct ?? '—'}% (${v.cited}/${v.total})`).join(' · ')
    : '';
  return `🤖 <b>AI Share of Voice: ${cur.sovPct}%</b> — нас цитируют нейросети (${cur.cited}/${cur.total} тем) ${trend}${byEng}`;
}

// CLI: node scripts/seo-agent/ai-citation-probe.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const okAigate = CONFIG.aigate?.apiKey || CONFIG.aigate?.key || readiness()?.aigate;
  if (!okAigate) { console.log('aigate не настроен (нет ключа) — probe невозможен'); process.exit(0); }
  probeAiCitation().then((r) => {
    console.log(sovReportLine(r).replace(/<\/?b>/g, ''));
    for (const d of r.details) {
      const eng = Object.entries(d.engines || {}).map(([k, v]) => `${v.cited ? '✓' : '·'}${k}`).join(' ');
      console.log(` [${eng}] ${d.q}`);
      const src = Object.values(d.engines || {}).flatMap((v) => v.sources || []);
      if (src.length) console.log('     источники: ' + [...new Set(src.map((u) => u.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]))].slice(0, 6).join(', '));
    }
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
