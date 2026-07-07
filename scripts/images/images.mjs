// Единый интерфейс генерации изображений: Pollinations.ai (основной, бесплатно) → kie.ai (резерв).
// Тот же паттерн, что у lib/uniqueness.mjs (content-watch → text.ru): пробуем дешёвый/бесплатный
// провайдер первым, при отказе — платный резерв, чтобы не остаться вообще без картинки.
import { pollinationsUrl, pollinationsCheck } from './pollinations.mjs';
import { generateNB2, optimizeTo, credits } from './kie-nb2.mjs';

export { optimizeTo, credits };
export const imageProvider = () => 'pollinations'; // kie.ai — молчаливый резерв, не основной путь

/** Полный цикл: промпт → оптимизированный файл в public/images. Pollinations → kie.ai при отказе. */
export async function makeImage({ name, prompt, ratio = '16:9', resolution = '2K', width, height, format = 'jpg', quality = 80 }) {
  try {
    const url = pollinationsUrl(prompt, { ratio, width, height });
    await pollinationsCheck(url);
    return await optimizeTo(url, { name, width, height, format, quality });
  } catch (e) {
    console.warn(`[images] Pollinations не сработал (${e.message}) — резерв kie.ai`);
  }
  const url = await generateNB2(prompt, { ratio, resolution });
  return optimizeTo(url, { name, width, height, format, quality });
}
