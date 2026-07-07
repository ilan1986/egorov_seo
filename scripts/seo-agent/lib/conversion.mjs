// Конверсионный оптимизатор: страницы с трафиком, но 0 заявок (цель формы) →
// вставляем контекстный CTA-блок под тему страницы (текст блока — из site.profile.mjs → cta.renderBlock).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { metrikaLanding } from './metrika.mjs';
import { fileForUrl } from './content.mjs';
import { ask } from './aigate.mjs';
import { ROOT_DIR } from '../config.mjs';
import { PROFILE } from '../../../site.profile.mjs';

const LOG = join(ROOT_DIR, 'scripts/seo-agent/data/cta-boosted.json');
const ANCHOR = `#${PROFILE.cta.anchor || 'zayavka'}`;
const today = () => new Date().toISOString().slice(0, 10);
const loadLog = () => { try { return JSON.parse(readFileSync(LOG, 'utf-8')); } catch { return {}; } };
const saveLog = (o) => writeFileSync(LOG, JSON.stringify(o, null, 2), 'utf-8');

/** Страницы: визитов ≥ minVisits, заявок 0, и есть наш MDX-файл. */
export async function conversionCandidates({ minVisits = 10, days = 90 } = {}) {
  const land = await metrikaLanding({ days, limit: 100 });
  return land
    .filter((p) => p.visits >= minVisits && p.conversions === 0 && fileForUrl(p.path))
    .sort((a, b) => b.visits - a.visits);
}

const SYS =
  'Ты пишешь ОДНО короткое предложение-подводку к заявке на русском (до 160 символов) для читателя из РФ. ' +
  'Без воды и восклицаний, по-деловому, отражает боль/задачу из темы страницы. Верни только предложение.';

/** Вставить контекстный CTA в страницу. Идемпотентно (лог + проверка контента). */
export async function boostCta(page, { apply = true } = {}) {
  const file = fileForUrl(page.path);
  if (!file) return null;
  const log = loadLog();
  if (log[page.path]) return null; // уже усиливали
  const raw = readFileSync(file, 'utf-8');
  // уже есть контекстный CTA в теле — помечаем и выходим
  if (raw.includes(ANCHOR) && /заявк/i.test(raw.split(/\n---\n/).slice(1).join('\n'))) {
    log[page.path] = today(); saveLog(log); return null;
  }
  const m = raw.match(/^(---\n[\s\S]*?\n---\n)([\s\S]*)$/);
  if (!m) return null;
  let [, fm, body] = m;

  const title = (fm.match(/^title:\s*(.+)$/m)?.[1] || '').replace(/^["']|["']$/g, '');
  let hook = 'Разберём вашу ситуацию и предложим решение.';
  try {
    const out = (await ask(SYS, `Тема страницы: «${title}». Дай подводку к заявке.`, { maxTokens: 120, temperature: 0.7 })).trim();
    if (out && out.length <= 200) hook = out.replace(/^["'«]|["'»]$/g, '');
  } catch { /* дефолтная подводка */ }

  const block = PROFILE.cta.renderBlock(hook);

  // вставить перед завершающим блоком (FAQ/CTA), иначе в конец тела
  const tailRe = /\n##\s+(?:Часто задаваемые|Вопросы|FAQ|Заключени|Итоги|Вывод|С чего начать|Как начать|Готовы|Оставьте|Свяжитесь|Записаться|Заказать)/i;
  const tail = body.search(tailRe);
  if (tail > -1) body = body.slice(0, tail) + '\n\n' + block + body.slice(tail);
  else body = body.replace(/\s*$/, '') + '\n\n' + block;

  if (fm.match(/^updated:.*$/m)) fm = fm.replace(/^updated:.*$/m, `updated: ${today()}`);
  else fm = fm.replace(/^(title:.*)$/m, `$1\nupdated: ${today()}`);

  if (apply) { writeFileSync(file, fm + body, 'utf-8'); log[page.path] = today(); saveLog(log); }
  return { path: page.path, visits: page.visits };
}

/** Прогнать конверс-оптимизацию по топ-N кандидатам. */
export async function optimizeConversions({ limit = 2, minVisits = 10, apply = true } = {}) {
  const cands = await conversionCandidates({ minVisits });
  const changed = [];
  for (const page of cands.slice(0, limit)) {
    try { const r = await boostCta(page, { apply }); if (r) changed.push(r); }
    catch { /* пропуск сбойной */ }
    await new Promise((res) => setTimeout(res, 500));
  }
  return changed;
}
