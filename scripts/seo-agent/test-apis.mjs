// Проверка связности интеграций. Запуск: node scripts/seo-agent/test-apis.mjs
import { readiness } from './config.mjs';
import { yandexSerp, scoreOpportunity } from './lib/xmlstock.mjs';
import { ask } from './lib/aigate.mjs';

const r = readiness();
console.log('Готовность интеграций:', r);

// 1) xmlstock
if (r.xmlstock) {
  try {
    const serp = await yandexSerp('бухгалтер для маркетплейсов');
    const score = scoreOpportunity(serp);
    console.log('\n[xmlstock] OK');
    console.log('  found:', serp.found, '| ease:', score.ease, '| агрегаторов в топе:', score.aggInTop);
    console.log('  топ-3:', serp.results.slice(0, 3).map((x) => x.domain).join(', '));
  } catch (e) {
    console.log('\n[xmlstock] FAIL:', e.message);
  }
} else console.log('\n[xmlstock] пропуск — нет ключа');

// 2) aigate
if (r.aigate) {
  try {
    const out = await ask(
      'Ты лаконичный ассистент. Отвечай одним словом.',
      'Ответь словом «работает», если ты на связи.',
      { maxTokens: 20, temperature: 0 }
    );
    console.log('\n[aigate] OK →', JSON.stringify(out.trim().slice(0, 60)));
  } catch (e) {
    console.log('\n[aigate] FAIL:', e.message);
  }
} else console.log('\n[aigate] пропуск — нет ключа');

console.log('\ntext.ru / Я.Вебмастер / Я.Метрика / Telegram — ждут ключей от пользователя.');
