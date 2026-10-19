// Chart.js is loaded lazily from a CDN. If it cannot load, every chart still shows its data as a table.
const URL = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
let loading, instances = [];
export function chartLibReady() {
  if (window.Chart) return Promise.resolve(true);
  return loading ||= new Promise(res => { const s = document.createElement('script'); s.src = URL; s.onload = () => res(!!window.Chart); s.onerror = () => { loading = null; res(false); }; document.head.append(s); });
}
export function destroyCharts() { instances.forEach(c => c.destroy()); instances = []; }
const td = (tag, v) => { const e = document.createElement(tag); e.textContent = v == null ? 'no record' : typeof v === 'number' ? (Math.round(v * 10) / 10).toString() : v; return e; };
// spec: { title, type:'line'|'bar', labels, datasets:[{label,data,color,dashed}], yTitle, head:[...], rows:[[...]] }
export async function drawChart(box, spec) {
  box.replaceChildren(); const ok = await chartLibReady(), cs = getComputedStyle(document.documentElement);
  const det = document.createElement('details'), sum = document.createElement('summary'), tb = document.createElement('table');
  sum.textContent = 'View data as a table'; tb.style.cssText = 'border-collapse:collapse;margin-top:.5rem;width:100%';
  const hr = document.createElement('tr'); spec.head.forEach(x => hr.append(td('th', x))); tb.append(hr);
  spec.rows.forEach(r => { const tr = document.createElement('tr'); r.forEach(v => { const c = td('td', v); c.style.cssText = 'border-top:1px solid var(--border);padding:2px 6px'; tr.append(c); }); tb.append(tr); });
  det.append(sum, tb); det.open = !ok;
  if (ok) {
    const wrap = document.createElement('div'), cv = document.createElement('canvas'); wrap.className = 'chartbox'; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', spec.title); wrap.append(cv); box.append(wrap);
    const text = cs.getPropertyValue('--text').trim(), grid = cs.getPropertyValue('--border').trim();
    instances.push(new window.Chart(cv, { type: spec.type, data: { labels: spec.labels, datasets: spec.datasets.map(d => ({ label: d.label, data: d.data, borderColor: d.color, backgroundColor: d.color + (spec.type === 'bar' ? 'cc' : '33'),
      borderDash: d.dashed ? [6, 4] : undefined, pointRadius: d.dashed ? 0 : 3, spanGaps: false, tension: .2 })) },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: text } } }, scales: { x: { ticks: { color: text }, grid: { color: grid } }, y: { beginAtZero: true, title: { display: !!spec.yTitle, text: spec.yTitle, color: text }, ticks: { color: text }, grid: { color: grid } } } } }));
  } else { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'The chart library could not load (you may be offline). Your data is shown as a table instead.'; box.append(p); }
  box.append(det);
}
