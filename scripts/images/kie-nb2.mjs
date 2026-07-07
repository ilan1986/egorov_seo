// Генерация изображений через kie.ai Nano Banana 2 + оптимизация через sharp.
// API: POST /api/v1/jobs/createTask → taskId; GET /api/v1/jobs/recordInfo?taskId=…
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import sharp from 'sharp';
import { CONFIG, ROOT_DIR } from '../seo-agent/config.mjs';

const { key, baseUrl } = CONFIG.kie;
const H = () => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assertKey() {
  if (!key) throw new Error('kie.ai: не задан KIE_API_KEY');
}

async function kie(path, init) {
  const res = await fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(60_000) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`kie HTTP ${res.status}: ${data?.msg || data?.message || ''}`);
  if (data && typeof data.code === 'number' && data.code !== 200) {
    throw new Error(`kie: ${data.msg || 'код ' + data.code}`);
  }
  return data;
}

export async function credits() {
  try {
    const d = await kie('/api/v1/chat/credit', { headers: H() });
    const v = d?.data;
    return typeof v === 'number' ? v : v?.credits ?? null;
  } catch {
    return null;
  }
}

const NB2_RATIOS = ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'];

/** Создать задачу text-to-image NB2 и дождаться URL результата. */
export async function generateNB2(prompt, { ratio = '16:9', resolution = '2K' } = {}) {
  assertKey();
  const aspect = NB2_RATIOS.includes(ratio) ? ratio : '16:9';
  const create = await kie('/api/v1/jobs/createTask', {
    method: 'POST',
    headers: H(),
    body: JSON.stringify({
      model: 'nano-banana-2',
      input: { prompt, aspect_ratio: aspect, resolution, output_format: 'png' },
    }),
  });
  const taskId = create?.data?.taskId;
  if (!taskId) throw new Error('kie: нет taskId');

  for (let i = 0; i < 60; i++) {
    await sleep(4000);
    const info = await kie(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers: H() });
    const d = info?.data || {};
    const state = String(d.state || d.status || '').toLowerCase();
    if (['fail', 'failed', 'error'].some((s) => state.includes(s))) {
      throw new Error(`kie: задача упала — ${d.failMsg || d.errorMessage || state}`);
    }
    if (['success', 'succeeded', 'complete'].some((s) => state.includes(s))) {
      let urls = [];
      if (d.resultJson) {
        const rj = typeof d.resultJson === 'string' ? JSON.parse(d.resultJson) : d.resultJson;
        urls = rj.resultUrls || rj.urls || [];
      }
      if (!urls.length && Array.isArray(d.resultUrls)) urls = d.resultUrls;
      if (!urls.length) throw new Error('kie: пустой результат');
      return urls[0];
    }
  }
  throw new Error('kie: таймаут ожидания');
}

/** Скачать и оптимизировать через sharp в public/images/<name>.<ext> */
export async function optimizeTo(url, { name, width, height, format = 'jpg', quality = 80 }) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`скачивание HTTP ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());

  let img = sharp(raw);
  if (width || height) {
    img = img.resize({ width, height, fit: width && height ? 'cover' : 'inside', withoutEnlargement: true });
  }
  if (format === 'webp') img = img.webp({ quality });
  else if (format === 'png') img = img.png({ compressionLevel: 9 });
  else img = img.jpeg({ quality, mozjpeg: true });

  const ext = format === 'jpg' ? 'jpg' : format;
  const rel = `images/${name}.${ext}`;
  const abs = resolve(ROOT_DIR, 'public', rel);
  mkdirSync(dirname(abs), { recursive: true });
  const info = await img.toFile(abs);
  return { abs, rel: `/${rel}`, bytes: info.size, w: info.width, h: info.height };
}

/** Полный цикл: промпт → оптимизированный файл в public/images. */
export async function makeImage({ name, prompt, ratio = '16:9', resolution = '2K', width, height, format = 'jpg', quality = 80 }) {
  const url = await generateNB2(prompt, { ratio, resolution });
  return optimizeTo(url, { name, width, height, format, quality });
}
