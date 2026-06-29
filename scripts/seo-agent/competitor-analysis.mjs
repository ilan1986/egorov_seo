// Анализ конкурентов по приоритетным ключам кластеров через xmlstock (Яндекс).
// Запуск: node scripts/seo-agent/competitor-analysis.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT_DIR } from './config.mjs';
import { yandexSerp, scoreOpportunity } from './lib/xmlstock.mjs';

const KEYWORDS = [
  // Маркетплейсы (флагман)
  ['marketplace', 'бухгалтер для маркетплейсов'],
  ['marketplace', 'бухгалтер вайлдберриз'],
  ['marketplace', 'бухгалтер озон'],
  ['marketplace', 'бухгалтерия для селлеров'],
  ['marketplace', 'налоги для селлеров маркетплейсов'],
  // Консалтинг/оптимизация
  ['optimizaciya', 'налоговый консультант'],
  ['optimizaciya', 'налоговая оптимизация'],
  ['optimizaciya', 'сопровождение налоговых проверок'],
  // Обслуживание
  ['obsluzhivanie', 'бухгалтерское обслуживание ип'],
  ['obsluzhivanie', 'бухгалтерское обслуживание ооо'],
  ['obsluzhivanie', 'бухгалтер на аутсорсе'],
  ['obsluzhivanie', 'ведение бухгалтерии ооо'],
  // Системы налогообложения
  ['rezhimy', 'какую систему налогообложения выбрать'],
  ['rezhimy', 'переход на усн'],
  // Зарплата
  ['zarplata', 'расчёт зарплаты аутсорсинг'],
  // Восстановление
  ['vosstanovlenie', 'восстановление бухгалтерского учёта'],
  // Регистрация
  ['registraciya', 'регистрация ип под ключ'],
  ['registraciya', 'регистрация ооо под ключ'],
  // Аудит
  ['audit', 'услуги аудитора'],
  ['audit', 'аудиторская проверка для ооо'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = [];
for (const [cluster, query] of KEYWORDS) {
  try {
    const serp = await yandexSerp(query, { groups: 10 });
    const score = scoreOpportunity(serp);
    rows.push({
      cluster,
      query,
      found: serp.found,
      aggInTop: score.aggInTop,
      ease: score.ease,
      top3: serp.results.slice(0, 3).map((r) => r.domain),
    });
    console.log(`ease ${String(score.ease).padStart(3)} | found ${String(serp.found ?? '?').padStart(9)} | агр ${score.aggInTop}/10 | ${query}`);
  } catch (e) {
    console.log(`FAIL | ${query} → ${e.message}`);
    rows.push({ cluster, query, error: e.message });
  }
  await sleep(900); // щадящий троттлинг
}

rows.sort((a, b) => (b.ease ?? -1) - (a.ease ?? -1));

const dir = resolve(ROOT_DIR, 'scripts/seo-agent/data');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'competitor-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2), 'utf-8');

console.log('\n========== ПРИОРИТЕТ (по лёгкости входа) ==========');
for (const r of rows) {
  if (r.error) continue;
  console.log(`[${r.ease}] ${r.query}  —  топ: ${r.top3.join(', ')}`);
}
console.log('\nОтчёт сохранён: scripts/seo-agent/data/competitor-report.json');
