// IndexNow + переобход. Быстрое уведомление поисковиков о новых URL.
import { CONFIG, DEFAULT_HEADERS } from '../config.mjs';
import { recrawl } from './webmaster.mjs';

/** Пинг IndexNow (Яндекс). Требует INDEXNOW_KEY и файл /<key>.txt на сайте. */
export async function indexNowPing(urls) {
  const key = CONFIG.indexNowKey;
  const host = new URL(CONFIG.siteUrl).host;
  const results = { indexnow: false, recrawl: 0 };
  if (key) {
    try {
      const res = await fetch('https://yandex.com/indexnow', {
        method: 'POST',
        headers: { ...DEFAULT_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, key, keyLocation: `${CONFIG.siteUrl}/${key}.txt`, urlList: urls }),
        signal: AbortSignal.timeout(30_000),
      });
      results.indexnow = res.ok;
    } catch {}
  }
  // Надёжный путь — очередь переобхода Вебмастера
  for (const u of urls) {
    if (await recrawl(u)) results.recrawl++;
  }
  return results;
}
