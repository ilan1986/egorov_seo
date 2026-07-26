// Авто-первое-касание (агентский режим): по кандидату (+ опц. аудиту) генерит персональный черновик
// первого письма/сообщения — с конкретной пользой под слабости сайта. Детерминированно, честно
// (предлагает бесплатный аудит, без спам-обещаний). НЕ отправляет — только текст для копирования.
import { PROFILE } from '../../../site.profile.mjs';

const dom = (u) => String(u).replace(/^https?:\/\//, '').replace(/\/$/, '');

/**
 * @param {object} prospect — из воронки: { url, name, score?, category? }
 * @param {object} [audit] — из auditClientSite() (если делали) — для конкретики
 * @returns {{subject, message}}
 */
export function renderOutreach(prospect, audit) {
  const a = PROFILE.agency || {};
  const d = dom(prospect.url);
  const wins = audit?.quickWins?.length ? audit.quickWins.slice(0, 2) : null;
  const painGeneric = (prospect.score ?? audit?.scores?.overall ?? 60) < 50
    ? 'сайт недобирает трафик и заявки из поиска'
    : 'есть быстрые точки роста в поиске';

  const subject = `${d}: больше заявок из Яндекса и нейросетей`;
  const message = [
    'Здравствуйте!',
    '',
    `Посмотрел ваш сайт ${d} — вижу конкретные точки роста в Яндексе и в ответах нейросетей (Яндекс Нейро, ChatGPT, Perplexity).`,
    wins ? `Например: ${wins.join('; ')}.` : `Сейчас ${painGeneric} — это чинится.`,
    '',
    'Могу прислать короткий бесплатный аудит с понятными шагами — без обязательств. Если по итогу захотите, возьму продвижение под ключ.',
    '',
    'Подскажите, кому и как удобнее показать разбор?',
    '',
    [a.name, a.telegram, a.contact].filter(Boolean).join('\n'),
  ].filter((x) => x !== undefined).join('\n');

  return { subject, message };
}

export function fmtOutreach(prospect, audit) {
  const o = renderOutreach(prospect, audit);
  return `✉️ <b>Черновик первого касания</b> — ${dom(prospect.url)}\n<b>Тема:</b> ${o.subject}\n\n<code>${o.message.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</code>\n\n<i>Скопируй и отправь на контакт клиента.</i>`;
}
