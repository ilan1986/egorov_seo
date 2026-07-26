// ПЕРВЫЙ ЗАПУСК агента. Отвечает на вопрос «зачем меня используют»: режим (свои/клиентские),
// зондирует сервер (что реально потянет), показывает план работы (7 шагов) с пометкой доступности
// и предупреждает о нехватках. Ничего не меняет и не тратит бюджет — только ориентирует.
// Запуск: node scripts/seo-agent/onboard.mjs [own|client] [--notify]
import { probeCapabilities, fmtCapabilities, gapsForMode } from './lib/capabilities.mjs';
import { fmtPlaybook } from './lib/playbook.mjs';
import { dailyBudgetUsd } from './lib/agent-journal.mjs';
import { readiness } from './config.mjs';

let PROFILE = {};
try { ({ PROFILE } = await import('../../site.profile.mjs')); } catch {}

const argMode = process.argv.find((a) => a === 'own' || a === 'client');
const MODE = argMode || PROFILE.mode || 'own';
const NOTIFY = process.argv.includes('--notify');

const rep = await probeCapabilities();
const caps = rep.capabilities.filter((c) => c.ok).map((c) => c.key);
const gaps = gapsForMode(rep, MODE);

const report = [
  `🚀 <b>Первый запуск SEO/GEO-агента</b>`,
  `Зачем меня используют: <b>${MODE === 'client' ? 'продвигать сайты клиентов' : 'создавать и продвигать свои сайты'}</b>` +
    (argMode ? '' : PROFILE.mode ? ' (из профиля)' : ' (по умолчанию; задай mode в site.profile.mjs)'),
  '',
  fmtCapabilities(rep, MODE),
  '',
  fmtPlaybook(MODE, caps),
  '',
  gaps.length
    ? `⚠️ <b>Для полноценной работы в этом режиме не хватает:</b> ${gaps.join(', ')}. Могу продолжить с тем, что есть (с ограничениями выше), или доустановить недостающее.`
    : `✅ <b>Всё критичное на месте</b> — можно работать по плану.`,
  `💸 Дневной бюджет ИИ/API: <b>$${dailyBudgetUsd()}</b>. Исчерпается — напишу сюда, решим вместе.`,
].join('\n');

// В консоль — без HTML
console.log(report.replace(/<[^>]+>/g, ''));

if (NOTIFY) {
  try {
    const { sendMessage } = await import('./bot/telegram.mjs').catch(() => import('../bot/telegram.mjs'));
    if (readiness().telegram && sendMessage) { await sendMessage(report); console.log('\n[onboard] отчёт отправлен в бот проекта'); }
    else console.log('\n[onboard] бот не настроен — отчёт только в консоли');
  } catch (e) { console.log('\n[onboard] бот недоступен:', e.message); }
}
