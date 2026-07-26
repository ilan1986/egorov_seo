// Графики для отчётов/КП: Apache ECharts в режиме SSR (renderToSVGString) → инлайн-SVG,
// который безопасно вкладывается в HTML и рендерится в PDF (gotenberg/wkhtmltopdf) без JS.
// echarts опционален: если не установлен — используется встроенный zero-dep SVG-рендер (gauge/bars),
// чтобы отчёт никогда не падал. Палитра синхронизирована с отчётом (client-report/proposal).
let _echarts;
async function echarts() {
  if (_echarts !== undefined) return _echarts;
  try { _echarts = (await import('echarts')); } catch { _echarts = null; }
  return _echarts;
}

const PAL = ['#5b8cff', '#2fbf71', '#e2b203', '#f2711c', '#e5484d', '#8a5bff', '#00b3a6'];
const scColor = (s) => (s == null ? '#8a93a6' : s >= 75 ? '#2fbf71' : s >= 60 ? '#e2b203' : s >= 40 ? '#f2711c' : '#e5484d');

/** ECharts option → SVG-строка (SSR). @returns {Promise<string|null>} */
export async function renderEChart(option, { width = 420, height = 260 } = {}) {
  const e = await echarts();
  if (!e) return null;
  const chart = e.init(null, null, { renderer: 'svg', ssr: true, width, height });
  try {
    chart.setOption({ animation: false, textStyle: { fontFamily: 'Segoe UI, Arial, sans-serif' }, ...option });
    return chart.renderToSVGString();
  } finally { chart.dispose(); }
}

/** Полукруглый gauge общего балла 0-100. */
export async function scoreGauge(score, label = 'Общий балл', opts = {}) {
  const svg = await renderEChart({
    series: [{
      type: 'gauge', startAngle: 200, endAngle: -20, min: 0, max: 100, radius: '96%', center: ['50%', '68%'],
      progress: { show: true, width: 16, itemStyle: { color: scColor(score) } },
      axisLine: { lineStyle: { width: 16, color: [[0.4, '#f2c0c2'], [0.6, '#ffe08a'], [0.75, '#ffd199'], [1, '#b6e8cd']] } },
      axisTick: { show: false }, splitLine: { length: 10, lineStyle: { color: '#c9d2e0' } },
      axisLabel: { distance: 18, fontSize: 10, color: '#8a93a6' }, pointer: { show: false },
      anchor: { show: false }, title: { show: true, offsetCenter: [0, '30%'], fontSize: 13, color: '#6b7280' },
      detail: { valueAnimation: false, offsetCenter: [0, '-2%'], fontSize: 40, fontWeight: 'bolder', color: scColor(score), formatter: '{value}' },
      data: [{ value: score ?? 0, name: label }],
    }],
  }, { width: opts.width || 300, height: opts.height || 210 });
  return svg || fallbackGauge(score, label, opts);
}

/** Горизонтальные бары категорий (0-100). items=[{label,value}] */
export async function categoryBars(items, opts = {}) {
  const cats = items.map((i) => i.label);
  const vals = items.map((i) => i.value ?? 0);
  const svg = await renderEChart({
    grid: { left: 130, right: 40, top: 10, bottom: 10 },
    xAxis: { type: 'value', max: 100, axisLabel: { color: '#8a93a6', fontSize: 10 }, splitLine: { lineStyle: { color: '#eef0f4' } } },
    yAxis: { type: 'category', data: cats, axisLabel: { color: '#1a2230', fontSize: 12 }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{
      type: 'bar', data: vals.map((v) => ({ value: v, itemStyle: { color: scColor(v), borderRadius: [0, 4, 4, 0] } })),
      barWidth: 16, label: { show: true, position: 'right', color: '#1a2230', fontSize: 11, fontWeight: 600 },
    }],
  }, { width: opts.width || 420, height: opts.height || Math.max(120, items.length * 34 + 20) });
  return svg || fallbackBars(items, opts);
}

/** Пончик распределения (напр. проблемы по важности). segments=[{label,value,color?}] */
export async function donut(segments, opts = {}) {
  const data = segments.filter((s) => s.value > 0).map((s, i) => ({ name: s.label, value: s.value, itemStyle: { color: s.color || PAL[i % PAL.length] } }));
  if (!data.length) return '';
  const svg = await renderEChart({
    legend: { orient: 'vertical', right: 6, top: 'center', textStyle: { fontSize: 11, color: '#1a2230' }, itemWidth: 12, itemHeight: 12 },
    series: [{
      type: 'pie', radius: ['52%', '78%'], center: ['32%', '50%'], avoidLabelOverlap: false,
      label: { show: false }, labelLine: { show: false }, data,
    }],
  }, { width: opts.width || 360, height: opts.height || 200 });
  return svg || '';
}

// ---- Zero-dep запасные рендеры (если echarts недоступен) ----
function fallbackGauge(score, label, { width = 300, height = 210 } = {}) {
  const s = Math.max(0, Math.min(100, score ?? 0));
  const cx = width / 2, cy = height * 0.72, r = Math.min(width, height * 1.3) * 0.4;
  const a0 = Math.PI * 1.111, a1 = Math.PI * (-0.111); // 200°..-20°
  const ang = a0 + (a1 - a0) * (s / 100);
  const pt = (a, rr = r) => [cx + Math.cos(a) * rr, cy - Math.sin(a) * rr];
  const [sx, sy] = pt(a0), [ex, ey] = pt(a1), [px, py] = pt(ang);
  const arc = (x1, y1, x2, y2, big) => `M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 ${big} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  const bigBg = 1, bigFg = ang < a0 - Math.PI ? 1 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<path d="${arc(sx, sy, ex, ey, bigBg)}" fill="none" stroke="#eef0f4" stroke-width="16" stroke-linecap="round"/>
<path d="${arc(sx, sy, px, py, bigFg)}" fill="none" stroke="${scColor(s)}" stroke-width="16" stroke-linecap="round"/>
<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-family="Segoe UI,Arial" font-size="40" font-weight="800" fill="${scColor(s)}">${s}</text>
<text x="${cx}" y="${cy + 26}" text-anchor="middle" font-family="Segoe UI,Arial" font-size="13" fill="#6b7280">${label}</text></svg>`;
}

function fallbackBars(items, { width = 420 } = {}) {
  const rowH = 30, padL = 130, padR = 44, top = 8;
  const h = items.length * rowH + top * 2;
  const bw = width - padL - padR;
  const rows = items.map((it, i) => {
    const y = top + i * rowH + 6, v = Math.max(0, Math.min(100, it.value ?? 0));
    return `<text x="${padL - 8}" y="${y + 12}" text-anchor="end" font-family="Segoe UI,Arial" font-size="12" fill="#1a2230">${esc(it.label)}</text>
<rect x="${padL}" y="${y}" width="${bw}" height="16" rx="4" fill="#eef0f4"/>
<rect x="${padL}" y="${y}" width="${(bw * v / 100).toFixed(1)}" height="16" rx="4" fill="${scColor(v)}"/>
<text x="${padL + bw + 6}" y="${y + 13}" font-family="Segoe UI,Arial" font-size="11" font-weight="600" fill="#1a2230">${v}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${rows}</svg>`;
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function chartsEngine() { return (await echarts()) ? 'echarts' : 'fallback-svg'; }
