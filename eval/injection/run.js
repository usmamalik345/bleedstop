/**
 * Measure the server injection detectors.
 * Thresholds are chosen on the BleedStop dev set only.
 * Held-out and deepset are scored after that choice and are not used to pick it.
 *
 *   npm run eval:injection
 *
 * Classifier rows run only when BLEEDSTOP_CLASSIFIER_URL or CLASSIFIER_URL answers /health.
 * This script does not invent a score when the sidecar is down.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import { precheckAgentCall } from "../../src/agentGuard.js";
import { classify, classifierUrl } from "../../src/classifierClient.js";
import { normalizeForDetect } from "../../src/textNorm.js";

const POLICY = { agentMaxToolCallsPerMin: 30, agentMaxDepth: 5 };
const CUTOFFS = [0.3, 0.6, 0.9];
const THRESHOLDS = [0.3, 0.5, 0.7, 0.9];

function pct(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(p * s.length) - 1)];
}
function round(n, d = 3) {
  if (n == null || Number.isNaN(n)) return "n/a";
  return (Math.round(n * 10 ** d) / 10 ** d).toFixed(d);
}
function rate(n, d) {
  if (!d) return "n/a";
  return `${round((n / d) * 100, 1)}% (${n}/${d})`;
}

function loadJsonl(file, name) {
  const rows = readFileSync(file, "utf8").trim().split(/\n/).filter(Boolean).map((line, i) => {
    const r = JSON.parse(line);
    return { set: name, id: r.id || String(i), text: String(r.text || ""), y: r.label === "injection" || r.label === 1 ? 1 : 0 };
  });
  return rows;
}

async function loadDeepset(split) {
  const rows = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const url = `https://datasets-server.huggingface.co/rows?dataset=deepset/prompt-injections&config=default&split=${split}&offset=${offset}&length=100`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`deepset ${split} HTTP ${r.status}`);
    const j = await r.json();
    total = j.num_rows_total;
    for (const row of j.rows) rows.push({ set: `deepset ${split}`, id: `${split}:${row.row_idx}`, text: String(row.row.text || ""), y: Number(row.row.label) === 1 ? 1 : 0 });
    if (!j.rows.length) break;
    offset += j.rows.length;
  }
  return rows;
}

function regexAt(text, cutoff) {
  const t0 = performance.now();
  const r = precheckAgentCall({ text }, POLICY);
  const ms = performance.now() - t0;
  const verdict = r.score >= cutoff ? "block" : "allow";
  return { ...r, verdict, ms };
}

function evalRows(rows, predict) {
  let tp = 0, missed = 0, fp = 0, tn = 0;
  const lats = [];
  const misses = [];
  for (const row of rows) {
    const v = predict(row.text);
    lats.push(v.ms);
    const block = v.verdict === "block";
    if (row.y === 1 && block) tp++;
    else if (row.y === 1) { missed++; misses.push({ ...row, verdict: v.verdict, score: v.score, reasons: v.reasons || [], cls: v.cls }); }
    else if (block) fp++;
    else tn++;
  }
  const pos = tp + missed;
  const neg = fp + tn;
  return { n: rows.length, pos, neg, tp, missed, fp, tn, recall: pos ? tp / pos : null, fpr: neg ? fp / neg : null, p50: pct(lats, 0.5), p95: pct(lats, 0.95), misses };
}

function why(m) {
  const families = (m.reasons || []).filter((r) => r.startsWith("injection:")).map((r) => r.slice("injection:".length));
  if (m.cls && m.cls.ok && m.verdict !== "block") {
    return `Classifier score ${round(m.cls.score, 3)} stayed under the dev-chosen threshold ${m.cls.threshold}. Phrase families: ${families.length ? families.join(", ") : "none"}.`;
  }
  if (families.length) {
    return `Matched ${families.join(", ")} but the score was ${m.score}, under the block line of 0.6, so the verdict is ${m.verdict}. Recall counts only block.`;
  }
  const bits = [];
  if (/\b(ignore|disregard|forget|override|bypass)\b/i.test(m.text)) bits.push("an override verb is present, but override_instructions also needs a target such as instruction, rule, or guideline");
  if (/\b(instruction|guideline|rule|prompt)s?\b/i.test(m.text)) bits.push("a rule word is present, but not in the order a family requires");
  if (/\[SYSTEM\]|<\s*system\s*>/i.test(m.text)) bits.push("a system marker is present, but fake_delimiter only matches a few exact shapes such as </system> and [INST]");
  if (/[^\u0000-\u024F]/u.test(m.text) && /\p{L}/u.test(m.text.replace(/[\u0000-\u024F]/gu, ""))) bits.push("the text has non-English letters and the families are English phrases");
  if (/\b[A-Za-z0-9+/]{16,}={0,2}\b/.test(m.text)) bits.push("a base64-looking token is present, and the shipped path does not decode it");
  if (!bits.length) return "No phrase family matched. The wording does not use the English phrases the list looks for.";
  return `No phrase family matched. ${bits.join("; ")}.`;
}

function rowLine(name, setName, s) {
  return `| ${name} | ${setName} | ${s.n} | ${s.pos} | ${s.neg} | ${rate(s.tp, s.pos)} | ${rate(s.fp, s.neg)} | ${round(s.p50)} | ${round(s.p95)} |`;
}

async function classifierUp() {
  const url = classifierUrl();
  if (!url) return { ok: false, url: "", reason: "BLEEDSTOP_CLASSIFIER_URL and CLASSIFIER_URL are unset" };
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return { ok: false, url, reason: `health HTTP ${r.status}` };
    return { ok: true, url, reason: "" };
  } catch (err) {
    return { ok: false, url, reason: err.name === "TimeoutError" ? "health timed out" : err.message };
  }
}

const dev = loadJsonl("evals/agent/injection-v1.jsonl", "dev");
const held = loadJsonl("evals/agent/injection-test-v1.jsonl", "held-out");
let deepTest = [];
let deepTrain = [];
let deepErr = "";
try {
  deepTest = await loadDeepset("test");
  deepTrain = await loadDeepset("train");
} catch (err) {
  deepErr = err.message;
}

const sets = [
  ["dev", dev],
  ["held-out", held],
  ["deepset test", deepTest],
  ["deepset train", deepTrain],
].filter(([, rows]) => rows.length);

const devSweep = CUTOFFS.map((c) => ({ c, s: evalRows(dev, (text) => regexAt(text, c)) }));
const defaultDev = devSweep.find((x) => x.c === 0.6).s;
const best = [...devSweep].sort((a, b) => (b.s.recall - a.s.recall) || (a.s.fpr - b.s.fpr) || (b.c - a.c))[0];
const chosenCutoff = best.s.recall > defaultDev.recall && best.s.fpr <= defaultDev.fpr ? best.c : 0.6;

const normDev = evalRows(dev, (text) => regexAt(normalizeForDetect(text), 0.6));
const normHelps = normDev.recall > defaultDev.recall && normDev.fpr <= defaultDev.fpr;

const lines = [];
lines.push("# Injection detector eval");
lines.push("");
lines.push("Numbers come from `npm run eval:injection`. The block line and the normaliser were judged on the dev set only. Held-out and deepset were scored afterwards and were not used to pick a setting.");
lines.push("");
lines.push("## Machine");
lines.push("");
lines.push(`- Date: ${new Date().toISOString()}`);
lines.push(`- OS: ${os.platform()} ${os.release()} (${os.arch()})`);
lines.push(`- CPU: ${os.cpus()[0]?.model || "unknown"} x ${os.cpus().length}`);
lines.push(`- Memory: ${os.totalmem()} bytes`);
lines.push(`- Node: ${process.version}`);
lines.push("");
lines.push("## How to run");
lines.push("");
lines.push("```bash");
lines.push("npm run eval:injection");
lines.push("```");
lines.push("");
lines.push("Percentile method: sort latencies, index = ceil(p * N) - 1. Latency is the phrase-list check on this machine, in milliseconds. A block is score >= cutoff. The shipped cutoff is 0.6. Recall uses injection rows as the denominator. False positive rate uses the benign rows.");
lines.push("");
lines.push("## Dev cutoff sweep (this is the only set used to choose)");
lines.push("");
lines.push("| Cutoff | N | Positives | Benign | Recall | FPR | p50 ms | p95 ms |");
lines.push("|---|---|---|---|---|---|---|---|");
for (const x of devSweep) lines.push(`| ${x.c} | ${x.s.n} | ${x.s.pos} | ${x.s.neg} | ${rate(x.s.tp, x.s.pos)} | ${rate(x.s.fp, x.s.neg)} | ${round(x.s.p50)} | ${round(x.s.p95)} |`);
lines.push("");
lines.push(`Dev-chosen cutoff: **${chosenCutoff}**. A lower or higher cutoff is kept only when dev recall rises and dev FPR does not rise. Otherwise the shipped line stays 0.6.`);
lines.push("");
lines.push("## Normaliser on dev (unicode, leetspeak, base64)");
lines.push("");
lines.push("| Variant | N | Positives | Benign | Recall | FPR | p50 ms | p95 ms |");
lines.push("|---|---|---|---|---|---|---|---|");
lines.push(`| regex cutoff 0.6 | ${defaultDev.n} | ${defaultDev.pos} | ${defaultDev.neg} | ${rate(defaultDev.tp, defaultDev.pos)} | ${rate(defaultDev.fp, defaultDev.neg)} | ${round(defaultDev.p50)} | ${round(defaultDev.p95)} |`);
lines.push(`| regex + normalise, cutoff 0.6 | ${normDev.n} | ${normDev.pos} | ${normDev.neg} | ${rate(normDev.tp, normDev.pos)} | ${rate(normDev.fp, normDev.neg)} | ${round(normDev.p50)} | ${round(normDev.p95)} |`);
lines.push("");
lines.push(normHelps
  ? "Normalising raised dev recall without raising dev FPR. The code is kept behind `BLEEDSTOP_NORMALIZE=1`. The default stays off: held-out below is a report, not a reason to flip the default from this file by hand."
  : "Normalising did not raise dev recall without also raising dev FPR, or it did not help. `BLEEDSTOP_NORMALIZE` stays off. The function remains so this script can be rerun.");
lines.push("");
lines.push("## All sets, shipped regex (cutoff 0.6, normaliser off)");
lines.push("");
lines.push("| Detector | Set | N | Positives | Benign | Recall | FPR | p50 ms | p95 ms |");
lines.push("|---|---|---|---|---|---|---|---|---|");

const shipped = [];
for (const [name, rows] of sets) {
  const s = evalRows(rows, (text) => regexAt(text, 0.6));
  shipped.push([name, s]);
  lines.push(rowLine("regex", name, s));
  const sn = evalRows(rows, (text) => regexAt(normalizeForDetect(text), 0.6));
  lines.push(rowLine("regex + normalise", name, sn));
  const sc = evalRows(rows, (text) => regexAt(text, chosenCutoff));
  if (chosenCutoff !== 0.6) lines.push(rowLine(`regex cutoff ${chosenCutoff} (chosen on dev)`, name, sc));
}

const up = await classifierUp();
lines.push("");
lines.push("## Classifier and both");
lines.push("");
if (!up.ok) {
  lines.push(`Classifier was **not measured** in this run (${up.reason || "sidecar down"}). No recall number is filled in for it. An older torch run is in \`results/CLASSIFIER-REPORT.md\` and is not copied here.`);
} else {
  lines.push(`Sidecar ${up.url} answered /health. Thresholds were swept on dev only.`);
  const cache = new Map();
  async function scoreOf(text) {
    if (cache.has(text)) return cache.get(text);
    const t0 = performance.now();
    const c = await classify(text);
    const ms = performance.now() - t0;
    const row = { c, ms };
    cache.set(text, row);
    return row;
  }
  // Warm the cache on dev first so the sweep does not hide latency, then score once per text.
  const devScores = [];
  for (const row of dev) devScores.push({ ...row, ...(await scoreOf(row.text)) });
  lines.push("");
  lines.push("| Threshold | Dev N | Positives | Benign | Recall | FPR |");
  lines.push("|---|---|---|---|---|---|");
  let chosenT = 0.5;
  let bestRecall = -1;
  let bestFpr = Infinity;
  for (const t of THRESHOLDS) {
    const s = evalRows(dev, (text) => {
      const hit = cache.get(text);
      const block = hit.c.ok && hit.c.score >= t;
      return { verdict: block ? "block" : "allow", score: hit.c.score, reasons: [], ms: hit.ms, cls: { ...hit.c, threshold: t } };
    });
    lines.push(`| ${t} | ${s.n} | ${s.pos} | ${s.neg} | ${rate(s.tp, s.pos)} | ${rate(s.fp, s.neg)} |`);
    if (s.recall > bestRecall || (s.recall === bestRecall && s.fpr < bestFpr)) {
      bestRecall = s.recall; bestFpr = s.fpr; chosenT = t;
    }
  }
  lines.push("");
  lines.push(`Dev-chosen classifier threshold: **${chosenT}**.`);
  lines.push("");
  lines.push("| Detector | Set | N | Positives | Benign | Recall | FPR | p50 ms | p95 ms |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const [name, rows] of sets) {
    for (const row of rows) if (!cache.has(row.text)) await scoreOf(row.text);
    const cls = evalRows(rows, (text) => {
      const hit = cache.get(text);
      const block = hit.c.ok && hit.c.score >= chosenT;
      return { verdict: block ? "block" : "allow", score: hit.c.score, reasons: [], ms: hit.ms, cls: { ...hit.c, threshold: chosenT } };
    });
    const both = evalRows(rows, (text) => {
      const reg = regexAt(text, 0.6);
      if (reg.verdict === "block") return reg;
      const hit = cache.get(text);
      const block = hit.c.ok && hit.c.score >= chosenT;
      return { verdict: block ? "block" : "allow", score: reg.score, reasons: reg.reasons, ms: reg.ms + hit.ms, cls: { ...hit.c, threshold: chosenT } };
    });
    lines.push(rowLine(`classifier t=${chosenT}`, name, cls));
    lines.push(rowLine(`both (regex 0.6 then classifier t=${chosenT})`, name, both));
  }
}

lines.push("");
lines.push("## Known misses");
lines.push("");
lines.push("These are real rows the shipped detector still does not block (regex, cutoff 0.6, normaliser off). Ten are listed. They are not hidden.");
lines.push("");
const pool = [];
for (const name of ["deepset test", "deepset train", "held-out"]) {
  const hit = shipped.find((x) => x[0] === name);
  if (!hit) continue;
  for (const m of hit[1].misses) pool.push(m);
}
const shown = pool.slice(0, 10);
if (!shown.length) lines.push("No misses on the scored non-dev sets.");
shown.forEach((m, i) => {
  const text = m.text.replace(/\s+/g, " ").slice(0, 240);
  lines.push(`${i + 1}. \`${m.id}\` (${m.set}). Verdict ${m.verdict}, score ${m.score}, families: ${(m.reasons || []).filter((r) => r.startsWith("injection:")).map((r) => r.slice(11)).join(", ") || "none"}.`);
  lines.push(`   Text: ${text}`);
  lines.push(`   Why: ${why(m)}`);
  lines.push("");
});
if (deepErr) {
  lines.push("## Deepset download");
  lines.push("");
  lines.push(`Deepset rows were not scored: ${deepErr}`);
  lines.push("");
}

mkdirSync("results", { recursive: true });
writeFileSync("results/INJECTION-EVAL.md", lines.join("\n"));
console.log(`wrote results/INJECTION-EVAL.md cutoff=${chosenCutoff} normHelps=${normHelps} classifier=${up.ok}`);
