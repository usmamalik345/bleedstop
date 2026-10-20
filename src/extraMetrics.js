/** Small labeled Prometheus registry for the MCP gateway and the OpenAI compatible proxy. */
const counters = new Map(); // name -> { help, series: Map<labelsKey, number> }
const hists = new Map(); // name -> { help, buckets, series: Map<labelsKey, {b:number[], sum, count}> }
const lk = (labels) => Object.entries(labels || {}).sort().map(([k, v]) => `${k}="${String(v).replace(/["\\\n]/g, "_")}"`).join(",");

export function inc(name, help, labels = {}, by = 1) {
  if (!counters.has(name)) counters.set(name, { help, series: new Map() });
  const s = counters.get(name).series; const k = lk(labels);
  s.set(k, (s.get(k) || 0) + by);
}
export function observe(name, help, value, labels = {}, buckets = [0.5, 1, 2, 5, 10, 25, 50, 100, 250, 1000]) {
  if (!hists.has(name)) hists.set(name, { help, buckets, series: new Map() });
  const h = hists.get(name); const k = lk(labels);
  const s = h.series.get(k) || { b: h.buckets.map(() => 0), sum: 0, count: 0 };
  h.buckets.forEach((le, i) => { if (value <= le) s.b[i]++; });
  s.sum += value; s.count++; h.series.set(k, s);
}
export function renderExtra() {
  const out = [];
  for (const [name, { help, series }] of counters) {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`);
    for (const [k, v] of series) out.push(`${name}${k ? `{${k}}` : ""} ${Math.round(v * 1e6) / 1e6}`);
  }
  for (const [name, { help, buckets, series }] of hists) {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} histogram`);
    for (const [k, s] of series) {
      const pre = k ? `${k},` : "";
      buckets.forEach((le, i) => out.push(`${name}_bucket{${pre}le="${le}"} ${s.b[i]}`));
      out.push(`${name}_bucket{${pre}le="+Inf"} ${s.count}`, `${name}_sum${k ? `{${k}}` : ""} ${s.sum}`, `${name}_count${k ? `{${k}}` : ""} ${s.count}`);
    }
  }
  return out.length ? out.join("\n") + "\n" : "";
}
export function resetExtra() { counters.clear(); hists.clear(); }
