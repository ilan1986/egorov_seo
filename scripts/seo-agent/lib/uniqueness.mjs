// Провайдер проверки уникальности: content-watch.ru (основной) → text.ru (резерв).
// Ядро-агент импортирует checkUniqueness отсюда, не привязываясь к конкретному сервису.
import { CONFIG } from '../config.mjs';
import * as cw from './contentwatch.mjs';
import * as tr from './textru.mjs';

/** Активный провайдер по наличию ключа. content-watch приоритетнее (дешевле). */
export function uniquenessProvider() {
  if (CONFIG.contentwatch.key) return 'content-watch';
  if (CONFIG.textru.key) return 'text.ru';
  return null;
}
export const uniquenessReady = () => Boolean(uniquenessProvider());

/**
 * Единый интерфейс проверки уникальности.
 * @returns { unique, pass, minUnique } (unique — процент уникальности).
 */
export async function checkUniqueness(text, opts = {}) {
  const p = uniquenessProvider();
  if (p === 'content-watch') return cw.checkUniqueness(text, opts);
  if (p === 'text.ru') return tr.checkUniqueness(text, opts);
  throw new Error('нет провайдера проверки уникальности (нет CONTENTWATCH_KEY/TEXTRU_KEY)');
}
