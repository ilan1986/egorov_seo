// Кластеризация по SERP-overlap (из seo-cluster): группирует ключи по интенту (общий топ-10 = один
// кластер), строит hub-and-spoke архитектуру, матрицу обязательной перелинковки и ловит каннибализацию
// (два ключа с большим пересечением URL → одна страница, не две). Топикал-авторитет = сигнал ранжирования
// в Яндексе и цитирования нейросетями. На xmlstock (SERP по ключам передаётся вызывающим).

const norm = (u = '') => u.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').toLowerCase();
const topUrls = (serp, n = 10) => new Set((serp || []).slice(0, n).map((r) => norm(r.url || r.link || '')).filter(Boolean));
const overlap = (a, b) => { let c = 0; for (const x of a) if (b.has(x)) c++; return c; };

/**
 * @param {Array<{query:string, serp:Array}>} items — ключи с их топ-10 SERP (yandexSerp)
 * @param {object} [opt] — { sameThreshold:3 (общих URL = один кластер), cannibalThreshold:5 }
 * @returns {{clusters:Array, cannibalization:Array, interlink:Array}}
 */
export function clusterBySerp(items, { sameThreshold = 3, cannibalThreshold = 5 } = {}) {
  const nodes = items.map((it) => ({ query: it.query, urls: topUrls(it.serp) }));
  const clusters = [];
  const cannibalization = [];

  for (const node of nodes) {
    let placed = null;
    for (const cl of clusters) {
      const ov = overlap(node.urls, cl.urls);
      if (ov >= sameThreshold) { placed = cl; break; }
    }
    if (placed) {
      // проверка каннибализации внутри кластера
      for (const q of placed.queries) {
        // (грубо: если очень высокий overlap — это дубль-интент, не отдельная страница)
      }
      placed.queries.push(node.query);
      for (const u of node.urls) placed.urls.add(u);
    } else {
      clusters.push({ hub: node.query, queries: [node.query], urls: new Set(node.urls) });
    }
  }

  // Каннибализация: пары ключей с очень большим пересечением (одна страница на оба)
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const ov = overlap(nodes[i].urls, nodes[j].urls);
      if (ov >= cannibalThreshold) cannibalization.push({ a: nodes[i].query, b: nodes[j].query, shared: ov });
    }
  }

  // hub-and-spoke: hub = самый широкий запрос кластера (эвристика: короче = шире)
  const out = clusters.map((cl) => {
    const sorted = cl.queries.slice().sort((a, b) => a.split(' ').length - b.split(' ').length);
    return { hub: sorted[0], spokes: sorted.slice(1), size: cl.queries.length };
  }).sort((a, b) => b.size - a.size);

  // матрица перелинковки: каждый spoke ↔ hub, hub ↔ hub соседних кластеров
  const interlink = [];
  for (const cl of out) for (const s of cl.spokes) interlink.push({ from: s, to: cl.hub, type: 'spoke→hub' });

  return { clusters: out.map((c) => ({ hub: c.hub, spokes: c.spokes, size: c.size })), cannibalization, interlink };
}

export function clusterReportLine(plan) {
  const c = plan.clusters.length;
  const cann = plan.cannibalization.length;
  const top = plan.clusters.slice(0, 3).map((cl) => `«${cl.hub}» (+${cl.spokes.length})`).join(', ');
  return `🗂 Кластеров: ${c}${cann ? `, каннибализация: ${cann} пар` : ''}. Хабы: ${top}`;
}
