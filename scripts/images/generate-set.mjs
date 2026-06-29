// Генерация стартового набора изображений сайта через NB2.
// Запуск: node scripts/images/generate-set.mjs   (пропускает уже существующие)
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { ROOT_DIR } from '../seo-agent/config.mjs';
import { credits, makeImage } from './kie-nb2.mjs';

const STYLE =
  'premium minimalist editorial photography, warm paper tones with deep emerald green accents, ' +
  'soft natural window light, shallow depth of field, calm and trustworthy mood, clean composition, ' +
  'no text, no logos, no watermark, no close-up faces';

const SET = [
  { name: 'home-work', w: 1600, h: 1100, ratio: '3:2',
    prompt: `Hands of a professional accountant working at a laptop showing clean financial charts, neat stacks of documents and a calculator on a light wooden desk, ${STYLE}` },
  { name: 'svc-marketplace', w: 1600, h: 900, ratio: '16:9',
    prompt: `Neat cardboard delivery parcels next to a laptop showing an online marketplace seller dashboard with sales charts, a softly blurred warehouse in the background, ${STYLE}` },
  { name: 'cover-marketplace-nalog', w: 1600, h: 900, ratio: '16:9',
    prompt: `A calculator, small delivery parcels and financial documents arranged on a desk, representing taxes for marketplace sellers, top-down flat lay, ${STYLE}` },
  { name: 'cover-sistemy', w: 1600, h: 900, ratio: '16:9',
    prompt: `A clean conceptual flat lay of several document folders, a magnifier and a fountain pen on a light desk, representing comparing tax options, ${STYLE}` },
  { name: 'cover-samozanyatyy', w: 1600, h: 900, ratio: '16:9',
    prompt: `A young entrepreneur seen from behind packing a parcel at a tidy home workspace with a laptop open to an online shop, ${STYLE}` },
];

// 1) Пере-сжать уже сгенерированную og-default.png → og-default.jpg (1200x630)
const ogPng = resolve(ROOT_DIR, 'public/images/og-default.png');
const ogJpg = resolve(ROOT_DIR, 'public/images/og-default.jpg');
if (existsSync(ogPng) && !existsSync(ogJpg)) {
  const info = await sharp(ogPng).resize({ width: 1200, height: 630, fit: 'cover' }).jpeg({ quality: 82, mozjpeg: true }).toFile(ogJpg);
  console.log(`[og] og-default.jpg ${Math.round(info.size / 1024)}КБ`);
}

const c = await credits();
console.log('[kie] кредиты:', c);

for (const item of SET) {
  const out = resolve(ROOT_DIR, `public/images/${item.name}.jpg`);
  if (existsSync(out)) { console.log(`= пропуск (есть): ${item.name}.jpg`); continue; }
  try {
    const r = await makeImage({ name: item.name, prompt: item.prompt, ratio: item.ratio, width: item.w, height: item.h, format: 'jpg', quality: 80 });
    console.log(`+ ${r.rel}  ${r.w}x${r.h}  ${Math.round(r.bytes / 1024)}КБ`);
  } catch (e) {
    console.log(`! ${item.name}: ${e.message}`);
  }
}
console.log('Готово.');
