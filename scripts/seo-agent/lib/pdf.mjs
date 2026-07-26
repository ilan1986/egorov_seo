// HTML → PDF. Основной движок — Gotenberg (Chromium в Docker: современный CSS/flexbox/grid/графики,
// кириллица штатно), резерв — wkhtmltopdf. htmlToPdf теперь ASYNC (gotenberg по HTTP).
// Gotenberg: docker run -d --name gotenberg --restart unless-stopped -p 3009:3000 gotenberg/gotenberg:8
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const GOTENBERG = (process.env.GOTENBERG_URL || 'http://localhost:3009').replace(/\/$/, '');

/** @param {string} html @returns {Promise<Buffer>} PDF */
export async function htmlToPdf(html) {
  // 1) Gotenberg (Chromium)
  try {
    const fd = new FormData();
    fd.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
    const r = await fetch(`${GOTENBERG}/forms/chromium/convert/html`, { method: 'POST', body: fd, signal: AbortSignal.timeout(30000) });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
  } catch { /* нет gotenberg — резерв */ }
  // 2) Резерв: wkhtmltopdf
  return htmlToPdfWk(html);
}

/** Синхронный резерв через wkhtmltopdf. */
export function htmlToPdfWk(html) {
  const dir = mkdtempSync(join(tmpdir(), 'pdf-'));
  const h = join(dir, 'in.html'); const p = join(dir, 'out.pdf');
  writeFileSync(h, html, 'utf-8');
  try {
    execFileSync('wkhtmltopdf', ['--quiet', '--encoding', 'utf-8', '--enable-local-file-access', '--print-media-type', '--margin-top', '14', '--margin-bottom', '14', h, p], { stdio: 'pipe', timeout: 60000 });
    return readFileSync(p);
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
}

export async function pdfEngine() {
  try { const r = await fetch(`${GOTENBERG}/health`, { signal: AbortSignal.timeout(3000) }); if (r.ok) return 'gotenberg'; } catch {}
  try { execFileSync('wkhtmltopdf', ['--version'], { stdio: 'pipe' }); return 'wkhtmltopdf'; } catch {}
  return 'none';
}
