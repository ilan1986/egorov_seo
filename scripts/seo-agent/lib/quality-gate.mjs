// Quality-gate ИИ-контента через promptfoo: прогоняет сгенерированный текст через набор
// ассертов (объём, клише/вода, структура, llm-рубрика на AiGate) ДО публикации. Возвращает
// вердикт {pass, score, checks[]} — агент блокирует/флагует слабый контент, а не льёт как есть.
// Требует: promptfoo (npm), env AIGATE_API_KEY. Порог слов — opts.minWords.
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CFG = join(HERE, '..', 'quality', 'promptfooconfig.yaml');

/**
 * @param {string} content — текст статьи (md/html/plain)
 * @param {object} [opts] { minWords=800, timeoutMs=120000, noLlm=false }
 * @returns {Promise<{pass:boolean, score:number, checks:Array<{name,pass,score,reason}>}>}
 */
export async function qualityGate(content, opts = {}) {
  const { minWords = 800, timeoutMs = 120000, noLlm = false } = opts;
  const dir = mkdtempSync(join(tmpdir(), 'qg-'));
  try {
    writeFileSync(join(dir, 'content.txt'), content, 'utf-8');
    cpSync(CFG, join(dir, 'promptfooconfig.yaml'));
    const out = join(dir, 'out.json');
    const env = { ...process.env, QG_MIN_WORDS: String(minWords) };
    if (noLlm) env.PROMPTFOO_DISABLE_LLM = '1'; // (рубрика всё равно ассерт; см. фильтр ниже)
    try {
      execFileSync('npx', ['promptfoo', 'eval', '-c', 'promptfooconfig.yaml', '-o', 'out.json', '--no-cache'],
        { cwd: dir, env, stdio: 'pipe', timeout: timeoutMs });
    } catch { /* ненулевой код = провал ассертов, результат всё равно в out.json */ }
    const res = JSON.parse(readFileSync(out, 'utf-8'));
    const r = res.results?.results?.[0] || res.results?.[0] || {};
    const comps = r.gradingResult?.componentResults || [];
    const checks = comps.map((c) => ({
      name: c.assertion?.type === 'llm-rubric' ? 'llm-рубрика'
        : c.assertion?.type === 'not-icontains-any' ? 'клише/вода'
        : (c.reason || '').includes('одзаголов') ? 'структура' : 'объём',
      pass: !!c.pass, score: c.score ?? (c.pass ? 1 : 0), reason: c.reason || '',
    }));
    const pass = checks.length ? checks.every((c) => c.pass) : !!r.success;
    const score = checks.length ? checks.reduce((s, c) => s + (c.score || 0), 0) / checks.length : (r.score || 0);
    return { pass, score: Math.round(score * 100) / 100, checks };
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
}

/** Есть ли promptfoo в окружении. */
export function qualityGateAvailable() {
  try { execFileSync('npx', ['promptfoo', '--version'], { stdio: 'pipe', timeout: 20000 }); return true; } catch { return false; }
}

/** Короткая сводка для лога/бота. */
export function fmtGate(v) {
  const head = `${v.pass ? '✅ прошёл' : '⛔ не прошёл'} quality-gate · балл ${v.score}`;
  return head + '\n' + v.checks.map((c) => `  ${c.pass ? '✓' : '✗'} ${c.name}: ${c.reason}`).join('\n');
}
