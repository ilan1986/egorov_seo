// Прокси-цепочка генерации картинок — единый эндпоинт llm-proxy /v1/images/generations.
// Внутри прокси фолбэк по кругу: am/flux.1-dev (anymodel, основная) → Pollinations →
// nano-banana-lite (anymodel) → gpt-image-2 (closerouter) → gemini-3-pro-image (aigate).
// Ключи держит прокси; сайт лишь шлёт промпт и размер. Возвращает URL картинки (тот же
// хост, по которому пришли: 127.0.0.1:8791 или docker-gateway) — optimizeTo его скачает.
const RATIO_SIZE = {
  '1:1': [1200, 1200], '2:3': [1000, 1500], '3:2': [1600, 1067], '3:4': [1200, 1600],
  '4:3': [1600, 1200], '9:16': [900, 1600], '16:9': [1600, 900], '21:9': [1800, 771], auto: [1600, 900],
};

// База: выделенный IMG_BASE_URL (обычно локальный llm-proxy с пулом ключей и цепочкой
// flux→imagen→z-image→pollinations) имеет приоритет; иначе — общий AIGATE/OPENAI; иначе — локальный прокси.
function baseUrl() {
  const b = process.env.IMG_BASE_URL || process.env.AIGATE_BASE_URL || process.env.OPENAI_BASE_URL || 'http://127.0.0.1:8791/v1';
  return b.replace(/\/+$/, '');
}

export const proxyImageReady = () => true;

/** Сгенерировать картинку через прокси-цепочку. Возвращает URL готового изображения. */
export async function proxyImageUrl(prompt, { ratio = '16:9', width, height } = {}) {
  const [rw, rh] = RATIO_SIZE[ratio] || RATIO_SIZE['16:9'];
  const w = width || rw;
  const h = height || rh;
  const res = await fetch(baseUrl() + '/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'flux', prompt, size: `${w}x${h}` }),
    signal: AbortSignal.timeout(140_000),
  });
  if (!res.ok) throw new Error(`proxy image HTTP ${res.status}`);
  const j = await res.json();
  const d = j && j.data && j.data[0];
  // Поддержка обоих форматов OpenAI-images: url ИЛИ b64_json (локальный прокси отдаёт b64).
  if (d && d.url) return d.url;
  if (d && d.b64_json) return `data:image/jpeg;base64,${d.b64_json}`; // optimizeTo (fetch) читает data:-URL в Node 18+
  throw new Error('proxy image: пустой ответ');
}
