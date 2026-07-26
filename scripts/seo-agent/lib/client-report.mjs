// Клиентский отчёт (агентский режим): рендер аудита в печатный HTML (SEO+GEO). PDF = печать этого HTML
// в браузере/headless-chrome (`chrome --headless --print-to-pdf=out.pdf file://report.html`).
// Брендинг агентства — из PROFILE.agency. Отдаёт готовую строку HTML (self-contained, для клиента).
import { PROFILE } from '../../../site.profile.mjs';
import { scoreGauge, categoryBars, donut } from './charts.mjs';

const A = () => PROFILE.agency || {};
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SEV = { critical: ['🛑 Критично', '#e5484d'], high: ['⚠️ Важно', '#f2711c'], medium: ['🔸 Средне', '#e2b203'], low: ['▫️ Мелочь', '#8a93a6'] };
const rating = (s) => (s == null ? '—' : s >= 90 ? 'отлично' : s >= 75 ? 'хорошо' : s >= 60 ? 'средне' : s >= 40 ? 'слабо' : 'критично');
const scColor = (s) => (s == null ? '#8a93a6' : s >= 75 ? '#2fbf71' : s >= 60 ? '#e2b203' : s >= 40 ? '#f2711c' : '#e5484d');

function scoreCard(label, val) {
  return `<div class="sc"><div class="sc-v" style="color:${scColor(val)}">${val ?? '—'}</div><div class="sc-l">${label}</div></div>`;
}

/** @param {object} audit — из auditClientSite(). ASYNC: рендерит графики (ECharts SSR → SVG). */
export async function renderClientReport(audit) {
  const a = A();
  const agency = a.name || PROFILE.bot?.projectName || 'SEO/GEO-агент';
  const s = audit.scores;

  // Графики (инлайн-SVG, безопасны для PDF)
  const sevCount = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of audit.findings) sevCount[f.sev] = (sevCount[f.sev] || 0) + 1;
  const [gaugeSvg, barsSvg, donutSvg] = await Promise.all([
    scoreGauge(s.overall, 'Общий балл'),
    categoryBars([
      { label: 'SEO', value: s.seo }, { label: 'GEO (нейросети)', value: s.geo },
      { label: 'Цитируемость', value: s.citability }, { label: 'Schema', value: s.schema },
    ]),
    donut([
      { label: 'Критично', value: sevCount.critical, color: '#e5484d' },
      { label: 'Важно', value: sevCount.high, color: '#f2711c' },
      { label: 'Средне', value: sevCount.medium, color: '#e2b203' },
      { label: 'Мелочь', value: sevCount.low, color: '#8a93a6' },
    ]),
  ]);
  const findings = audit.findings.map((f) => {
    const [lbl, col] = SEV[f.sev] || SEV.low;
    return `<tr><td><span style="color:${col};white-space:nowrap">${lbl}</span></td><td>${esc(f.cat).toUpperCase()}</td><td>${esc(f.msg)}</td></tr>`;
  }).join('');
  const pages = audit.pages.map((p) => `<tr><td>${esc(p.url)}</td><td>${p.words}</td><td style="color:${scColor(p.citability)}">${p.citability}</td><td>${p.schema.length ? '✓' : '—'}</td><td>${p.hasDesc ? '✓' : '—'}</td></tr>`).join('');

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>SEO/GEO-аудит ${esc(audit.url)}</title>
<style>
  @page{margin:16mm}
  body{font:14px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a2230;margin:0;padding:24px;max-width:900px}
  h1{font-size:26px;margin:0 0 4px} h2{font-size:18px;margin:28px 0 10px;border-bottom:2px solid #eef0f4;padding-bottom:6px}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1a2230;padding-bottom:14px;margin-bottom:20px}
  .mut{color:#6b7280;font-size:13px}
  .scores{display:flex;gap:14px;flex-wrap:wrap;margin:18px 0}
  .sc{flex:1;min-width:120px;background:#f7f8fa;border:1px solid #eef0f4;border-radius:12px;padding:14px;text-align:center}
  .sc-v{font-size:34px;font-weight:800;line-height:1} .sc-l{color:#6b7280;font-size:12.5px;margin-top:6px}
  table{width:100%;border-collapse:collapse;margin:10px 0;font-size:13px} th,td{border:1px solid #eef0f4;padding:8px 10px;text-align:left;vertical-align:top} th{background:#f7f8fa}
  .wins{background:#f0f7ff;border:1px solid #d6e6ff;border-radius:10px;padding:14px 18px} .wins li{margin:4px 0}
  .viz{display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin:16px 0}
  .viz-g{flex:0 0 auto} .viz-b{flex:1;min-width:300px} .viz svg,.viz-d svg{max-width:100%;height:auto}
  .viz-d{margin:10px 0} .viz-d .mut{margin-top:2px}
  .foot{margin-top:30px;color:#6b7280;font-size:12.5px;border-top:1px solid #eef0f4;padding-top:12px}
</style></head><body>
<div class="head">
  <div><h1>SEO/GEO-аудит сайта</h1><div class="mut">${esc(audit.url)} · ${audit.checkedAt}${audit.businessType && audit.businessType !== 'content' ? ` · ${audit.businessType === 'local' ? 'локальный бизнес' : audit.businessType === 'shop' ? 'интернет-магазин' : ''}` : ''}</div></div>
  <div style="text-align:right"><b>${esc(agency)}</b>${a.contact ? `<div class="mut">${esc(a.contact)}</div>` : ''}</div>
</div>

<h2>Оценка</h2>
<div class="viz">
  <div class="viz-g">${gaugeSvg}</div>
  <div class="viz-b">${barsSvg}</div>
</div>
<p>Итоговая оценка сайта — <b>${s.overall}/100 (${rating(s.overall)})</b>. Проверено страниц: ${audit.signals.pagesChecked}.
AI-краулеры ${audit.signals.aiBlocked >= 3 ? '<b style="color:#e5484d">заблокированы</b>' : 'открыты'}, llms.txt ${audit.signals.hasLlms ? 'есть' : '<b>отсутствует</b>'}.</p>

${audit.quickWins.length ? `<h2>Быстрые победы</h2><div class="wins"><ol>${audit.quickWins.map((w) => `<li>${esc(w)}</li>`).join('')}</ol></div>` : ''}

<h2>Найденные проблемы</h2>
${donutSvg ? `<div class="viz-d">${donutSvg}<div class="mut">Распределение проблем по важности</div></div>` : ''}
<table><thead><tr><th>Приоритет</th><th>Раздел</th><th>Проблема</th></tr></thead><tbody>${findings || '<tr><td colspan="3">Критичных проблем не найдено.</td></tr>'}</tbody></table>

<h2>Проверенные страницы</h2>
<table><thead><tr><th>URL</th><th>Слов</th><th>Цитируемость</th><th>Schema</th><th>Description</th></tr></thead><tbody>${pages}</tbody></table>

<div class="foot">Отчёт подготовлен ${esc(agency)}${a.contact ? ' · ' + esc(a.contact) : ''}. Методика: краулинг публичных страниц, детерминированная оценка SEO/GEO-сигналов (цитируемость, Schema, доступ AI-ботов, llms.txt, on-page).</div>
</body></html>`;
}
