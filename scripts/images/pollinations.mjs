// Pollinations.ai (FLUX) — бесплатная генерация изображений, без ключа.
// Основной провайдер картинок ядра (см. images.mjs) — kie.ai остаётся резервом на случай
// перегрузки/недоступности бесплатного сервиса (без SLA).
const BASE = 'https://image.pollinations.ai/prompt';
// Токен pollinations (POLLINATIONS_TOKEN в .env) шлём заголовком Authorization. На бесплатном тарифе
// лимит = 1 одновременный запрос на IP → при залпе кронов с одного VPS сыпется 429. Токен + ретрай
// ниже пережидают очередь; безлимит — только платный enter.pollinations.ai.
const TOKEN = (process.env.POLLINATIONS_TOKEN || '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RATIO_SIZE = {
  '1:1': [1200, 1200],
  '2:3': [1000, 1500],
  '3:2': [1600, 1067],
  '3:4': [1200, 1600],
  '4:3': [1600, 1200],
  '9:16': [900, 1600],
  '16:9': [1600, 900],
  '21:9': [1800, 771],
  auto: [1600, 900],
};

export const pollinationsReady = () => true; // не требует ключа

/** Вернуть готовый к скачиванию URL картинки (сам сервис генерирует по запросу). */
export function pollinationsUrl(prompt, { ratio = '16:9', width, height, seed = 42 } = {}) {
  const [rw, rh] = RATIO_SIZE[ratio] || RATIO_SIZE['16:9'];
  const w = width || rw;
  const h = height || rh;
  const encoded = encodeURIComponent(prompt);
  return `${BASE}/${encoded}?width=${w}&height=${h}&model=flux&nologo=true&seed=${seed}`;
}

/** Проверить, что URL реально отдаёт картинку. Ретрай с бэкоффом на 429 (очередь IP занята другим
 * кроном) и 5xx — пережидаем, пока освободится 1 слот, вместо мгновенного падения в платный kie. */
export async function pollinationsCheck(url) {
  const headers = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
      if (res.ok) return url;
      if (res.status === 429 || res.status >= 500) { lastErr = new Error(`pollinations HTTP ${res.status}`); await sleep(9000 + attempt * 8000); continue; }
      throw new Error(`pollinations HTTP ${res.status}`);
    } catch (e) { lastErr = e; await sleep(7000 + attempt * 7000); }
  }
  throw lastErr || new Error('pollinations: не удалось после ретраев');
}
