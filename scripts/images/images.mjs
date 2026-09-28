// Единый интерфейс генерации изображений: прокси-цепочка (flux→imagen→z-image→pollinations) → прямой Pollinations.
// kie.ai ОТКЛЮЧЁН из цепочки (по решению 27.09) — не тратим kie-баланс на обложки сети.
import { pollinationsUrl, pollinationsCheck } from './pollinations.mjs';
import { optimizeTo, credits } from './kie-nb2.mjs';
import { proxyImageUrl, proxyImageReady } from './proxy-image.mjs';

export { optimizeTo, credits };
export const imageProvider = () => 'proxy'; // прокси-цепочка основной путь; Pollinations — резерв

/** Полный цикл: промпт → оптимизированный файл в public/images.
 *  Цепочка: прокси (flux→imagen-fast→z-image→pollinations, ключи в прокси) → прямой Pollinations. kie отключён. */
export async function makeImage({ name, prompt, ratio = '16:9', resolution = '2K', width, height, format = 'jpg', quality = 80 }) {
  // 0) прокси-цепочка (несколько провайдеров/моделей + ротация ключей — переживает отключение любой)
  if (proxyImageReady()) {
    try {
      const url = await proxyImageUrl(prompt, { ratio, width, height });
      return await optimizeTo(url, { name, width, height, format, quality });
    } catch (e) { console.warn(`[images] прокси-картинка не сработала (${e.message}) — прямой Pollinations`); }
  }
  // 1) прямой Pollinations (последний резерв; kie отключён из цепочки)
  const url = pollinationsUrl(prompt, { ratio, width, height });
  await pollinationsCheck(url);
  return await optimizeTo(url, { name, width, height, format, quality });
}
