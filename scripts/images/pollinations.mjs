// Pollinations.ai (FLUX) — бесплатная генерация изображений, без ключа.
// Основной провайдер картинок ядра (см. images.mjs) — kie.ai остаётся резервом на случай
// перегрузки/недоступности бесплатного сервиса (без SLA).
const BASE = 'https://image.pollinations.ai/prompt';

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

/** Проверить, что URL реально отдаёт картинку (сервис публичный, без SLA — иногда 500/перегружен). */
export async function pollinationsCheck(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`pollinations HTTP ${res.status}`);
  return url;
}
