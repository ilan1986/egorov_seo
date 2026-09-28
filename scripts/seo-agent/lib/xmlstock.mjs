// Клиент xmlstock: поисковая выдача и оценка конкуренции (Яндекс/Google XML).
import { CONFIG, DEFAULT_HEADERS } from '../config.mjs';
import { logCall } from './cost-ledger.mjs';

const { user, key, lr } = CONFIG.xmlstock;

function assertKeys() {
  if (!user || !key) throw new Error('xmlstock: не заданы XMLSTOCK_USER/XMLSTOCK_KEY');
}

async function fetchText(url) {
  const res = await fetch(url, { headers: DEFAULT_HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`xmlstock HTTP ${res.status}`);
  return res.text();
}

/** Достать содержимое первого тега из XML (простой парсер без зависимостей). */
function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : null;
}
function tagAll(xml, name) {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function stripCdata(s) {
  return (s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
}

/**
 * Яндекс: число результатов (конкуренция) + топ-выдача.
 * Возвращает { query, found, results:[{url, domain, title}] }
 */
export async function yandexSerp(query, { groups = 10 } = {}) {
  assertKeys();
  logCall('xmlstock'); // баланс через API не публикует; считаем запросы
  const groupby = `attr%3D%22%22.mode%3Dflat.groups-on-page%3D${groups}.docs-in-group%3D1`;
  const url =
    `https://xmlstock.com/yandex/xml/?user=${user}&key=${key}` +
    `&query=${encodeURIComponent(query)}&lr=${lr}&groupby=${groupby}`;
  const xml = await fetchText(url);

  const foundRaw = tag(xml, 'found');
  const found = foundRaw ? Number(stripCdata(foundRaw).replace(/\D/g, '')) : null;

  const docs = tagAll(xml, 'doc');
  const results = docs.map((d) => {
    const u = stripCdata(tag(d, 'url') || '');
    let domain = '';
    try { domain = new URL(u).hostname.replace(/^www\./, ''); } catch {}
    return { url: u, domain, title: stripCdata(tag(d, 'title') || '') };
  });

  const errCode = tag(xml, 'error');
  if (errCode && results.length === 0) {
    throw new Error(`xmlstock error: ${stripCdata(errCode)}`);
  }
  return { query, found, results };
}

/** Грубая оценка «лёгкости» ключа: чем меньше found и больше агрегаторов/маркетплейсов в топе — тем легче. */
export function scoreOpportunity({ found, results }) {
  const AGG = ['avito.ru', 'youla.ru', 'profi.ru', 'yandex.ru', 'vk.com', 'zen.yandex.ru', 'dzen.ru', 'ozon.ru', 'wildberries.ru'];
  const aggInTop = results.filter((r) => AGG.some((a) => r.domain.endsWith(a))).length;
  // нормируем found в лог-шкалу
  const comp = found ? Math.min(1, Math.log10(found + 1) / 7) : 0.5;
  // больше агрегаторов в топе → слабее коммерческие конкуренты → проще зайти
  const aggBonus = Math.min(1, aggInTop / Math.max(1, results.length));
  const ease = Math.round((1 - comp) * 60 + aggBonus * 40); // 0..100
  return { found, aggInTop, ease };
}
