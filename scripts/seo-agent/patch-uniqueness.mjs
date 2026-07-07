// Миграционный патч: переключить проверку уникальности с text.ru на провайдер (content-watch → text.ru).
// Идемпотентно. Запуск из корня проекта: node scripts/seo-agent/patch-uniqueness.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const AGENT = resolve(process.cwd(), 'scripts/seo-agent');
const log = (...a) => console.log('[patch]', ...a);

function patch(file, edits) {
  if (!existsSync(file)) { log('нет файла:', file); return; }
  let s = readFileSync(file, 'utf-8');
  let changed = false;
  for (const [find, repl, guard] of edits) {
    if (guard && s.includes(guard)) continue; // уже применено
    if (!s.includes(find)) { log('  не найдено в', file, '→', find.slice(0, 40)); continue; }
    s = s.replace(find, repl);
    changed = true;
  }
  if (changed) { writeFileSync(file, s, 'utf-8'); log('patched:', file); }
  else log('без изменений:', file);
}

// 1) config.mjs — блок contentwatch + readiness
patch(resolve(AGENT, 'config.mjs'), [
  [
    "minUnique: Number(env('TEXTRU_MIN_UNIQUE', '82')),\n  },",
    "minUnique: Number(env('TEXTRU_MIN_UNIQUE', '82')),\n  },\n  contentwatch: {\n    key: env('CONTENTWATCH_KEY'),\n    minUnique: Number(env('CONTENTWATCH_MIN', env('TEXTRU_MIN_UNIQUE', '82'))),\n  },",
    'contentwatch: {',
  ],
  [
    'textru: Boolean(CONFIG.textru.key),',
    "textru: Boolean(CONFIG.textru.key),\n    contentwatch: Boolean(CONFIG.contentwatch.key),\n    uniqueness: Boolean(CONFIG.contentwatch.key || CONFIG.textru.key),",
    'uniqueness: Boolean',
  ],
]);

// 2) run.mjs — импорт + readiness
patch(resolve(AGENT, 'run.mjs'), [
  ["from './lib/textru.mjs'", "from './lib/uniqueness.mjs'", "uniqueness.mjs'"],
  ['readiness().textru', 'readiness().uniqueness', null],
]);

// 3) generate-post.mjs — импорт
patch(resolve(AGENT, 'lib/generate-post.mjs'), [
  ["from './textru.mjs'", "from './uniqueness.mjs'", "uniqueness.mjs'"],
]);

log('готово. Не забудь: положить lib/contentwatch.mjs + lib/uniqueness.mjs и CONTENTWATCH_KEY в .env');
