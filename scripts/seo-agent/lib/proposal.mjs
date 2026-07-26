// Генератор КП (коммерческого предложения) для клиентского сайта — агентский режим.
// Вход: аудит (auditClientSite) + тарифы из PROFILE.agency.packages. Выход: печатный HTML КП:
// проблемы → что сделаем → пакет → цена → сроки. Продаёт результат, а не «часы».
import { PROFILE } from '../../../site.profile.mjs';
import { scoreGauge } from './charts.mjs';

const A = () => PROFILE.agency || {};
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (n) => (n == null ? 'по договорённости' : new Intl.NumberFormat('ru-RU').format(n) + ' ₽');

// Рекомендация пакета по общему баллу: чем ниже — тем плотнее работа.
function recommend(score, packages) {
  if (!packages?.length) return null;
  if (score < 45 && packages.length >= 3) return packages[packages.length - 1]; // максимальный
  if (score < 70 && packages.length >= 2) return packages[1];
  return packages[0];
}

/**
 * @param {object} audit — из auditClientSite()
 * @param {object} [opts] — { clientName, packageId }
 */
export async function renderProposal(audit, { clientName, packageId } = {}) {
  const a = A();
  const agency = a.name || PROFILE.bot?.projectName || 'SEO/GEO-агентство';
  const gaugeSvg = await scoreGauge(audit.scores.overall, 'Сейчас');
  const packages = a.packages || [];
  const pkg = packageId ? packages.find((p) => p.id === packageId) : recommend(audit.scores.overall, packages);

  const problems = audit.findings.filter((f) => f.sev === 'critical' || f.sev === 'high').slice(0, 6);
  const scope = pkg?.includes || [
    'Технический SEO-аудит и исправления', 'Семантика и контент-план',
    'GEO-оптимизация под цитирование нейросетями (Schema, llms.txt, citability)',
    'Ежемесячный отчёт по позициям, трафику и заявкам',
  ];

  const priceRow = pkg
    ? `<div class="price"><div><div class="pk">${esc(pkg.name)}</div><div class="mut">${esc(pkg.period || 'в месяц')}</div></div><div class="pv">${money(pkg.price)}</div></div>`
    : `<div class="price"><div class="pk">Индивидуально</div><div class="pv">по договорённости</div></div>`;

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>КП — ${esc(audit.url)}</title>
<style>
  @page{margin:16mm}
  body{font:14px/1.65 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a2230;margin:0;padding:26px;max-width:900px}
  h1{font-size:27px;margin:0 0 4px} h2{font-size:18px;margin:26px 0 10px}
  .head{border-bottom:3px solid #5b8cff;padding-bottom:14px;margin-bottom:8px;display:flex;justify-content:space-between}
  .mut{color:#6b7280;font-size:13px}
  ul{padding-left:20px} li{margin:5px 0}
  .price{display:flex;justify-content:space-between;align-items:center;background:linear-gradient(90deg,#eef4ff,#f7f0ff);border:1px solid #d6e0ff;border-radius:14px;padding:18px 22px;margin:14px 0}
  .pk{font-size:19px;font-weight:800} .pv{font-size:26px;font-weight:800;color:#3b5bdb}
  .cta{background:#1a2230;color:#fff;border-radius:12px;padding:16px 20px;margin-top:18px}
  .cta a{color:#8fb4ff}
  table{width:100%;border-collapse:collapse;font-size:13px} td{border-bottom:1px solid #eef0f4;padding:7px 4px}
</style></head><body>
<div class="head">
  <div><h1>Коммерческое предложение</h1><div class="mut">SEO + GEO-продвижение · ${esc(audit.url)}</div></div>
  <div style="text-align:right"><b>${esc(agency)}</b>${a.contact ? `<div class="mut">${esc(a.contact)}</div>` : ''}</div>
</div>
${clientName ? `<p>Для: <b>${esc(clientName)}</b></p>` : ''}

<h2>Что показал экспресс-аудит</h2>
<div style="float:right;margin:0 0 8px 16px">${gaugeSvg}</div>
<p>Общая оценка сайта — <b>${audit.scores.overall}/100</b> (SEO ${audit.scores.seo}, GEO ${audit.scores.geo}, цитируемость ${audit.scores.citability}). Ключевое, что теряет трафик и заявки:</p>
<ul>${(problems.length ? problems.map((p) => `<li>${esc(p.msg)}</li>`) : ['<li>Точки роста есть — детально разберём на старте.</li>']).join('')}</ul>

<h2>Что сделаем</h2>
<ul>${scope.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>

<h2>Стоимость</h2>
${priceRow}
${pkg?.note ? `<p class="mut">${esc(pkg.note)}</p>` : ''}

<h2>Результат</h2>
<p>Рост органического трафика из Яндекса, попадание в ответы нейросетей (Яндекс Нейро, ChatGPT, Perplexity) и, как следствие, — больше заявок и звонков. Прозрачный ежемесячный отчёт: позиции, трафик, заявки, GEO-метрики.</p>

<div class="cta">Готовы начать? Свяжитесь: <b>${esc(a.contact || a.name || '')}</b>${a.telegram ? ` · <a href="${esc(a.telegram)}">Telegram</a>` : ''}</div>
</body></html>`;
}
