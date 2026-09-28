// Проверка подключения к Joomla + предпросмотр публикации. Запуск: node scripts/seo-agent/test-joomla.mjs
// Требует в site.profile.mjs блок publish: { type: 'joomla', ... } и токен в env (tokenEnv).
import { PROFILE } from '../../site.profile.mjs';
import { testJoomlaConnection, parsePost, buildArticleHtml } from './lib/publish-joomla.mjs';

const cfg = PROFILE.publish;
if (!cfg || cfg.type !== 'joomla') {
  console.error('❌ site.profile.mjs: нет блока publish: { type: "joomla", ... }');
  process.exit(1);
}
console.log(`Проверяю Joomla: ${cfg.baseUrl}  (токен из env ${cfg.tokenEnv || 'JOOMLA_TOKEN'})`);
const r = await testJoomlaConnection(cfg);
if (r.ok) {
  console.log(`✅ Соединение и токен OK. Web Services включены, статей видно: ${r.articles}.`);
  console.log(`   Категория для публикации: catid=${cfg.catid}, язык=${cfg.language || '*'}.`);
} else {
  console.error(`❌ Не удалось: ${r.error}`);
  console.error('   Проверь: 1) плагин «API Authentication - Token» включён; 2) токен пользователя в env;');
  console.error('            3) плагин «Web Services - Content» включён; 4) baseUrl без /api на конце.');
}

// Демонстрация конвертации (если передан путь к MDX-файлу вторым аргументом)
const sample = process.argv[2];
if (sample) {
  const { readFileSync } = await import('node:fs');
  const post = parsePost(readFileSync(sample, 'utf-8'), 'demo');
  const html = buildArticleHtml(post, cfg);
  console.log('\n── Предпросмотр HTML для Joomla (первые 600 симв.) ──');
  console.log(html.slice(0, 600));
}
process.exit(r.ok ? 0 : 1);
