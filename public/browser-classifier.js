// In browser second stage: protectai/deberta-v3-base-prompt-injection-v2, 8 bit weight only ONNX build
// (scripts/build-browser-model.py), run with onnxruntime-web (WASM, CPU). Loaded only on demand.
const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.wasm.min.mjs";
const TOK = "https://cdn.jsdelivr.net/npm/@huggingface/tokenizers@0.2.0/dist/tokenizers.mjs";
const BASE = new URLSearchParams(location.search).get("modelBase") || "https://usmamalik345.github.io/bleedstop/models/deberta-pi-v2-q8/";
let ready = null;
export const state = { loaded: false, bytes: 0, total: 0, loadMs: 0 };

export function load(onProgress = () => {}) {
  if (ready) return ready;
  ready = (async () => {
    const t0 = performance.now();
    const [ort, { Tokenizer }, manifest] = await Promise.all([import(ORT), import(TOK), fetch(BASE + "manifest.json").then((r) => r.json())]);
    state.total = manifest.bytes; onProgress(state);
    const [tj, tc] = await Promise.all([fetch(BASE + "tokenizer.json").then((r) => r.json()), fetch(BASE + "tokenizer_config.json").then((r) => r.json())]);
    const buf = new Uint8Array(manifest.bytes); let off = 0;
    for (const p of manifest.parts) {
      const r = await fetch(BASE + p); const reader = r.body.getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; buf.set(value, off); off += value.length; state.bytes = off; onProgress(state); }
    }
    ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 1);
    ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
    const session = await ort.InferenceSession.create(buf, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    const tokenizer = new Tokenizer(tj, tc);
    state.loaded = true; state.loadMs = performance.now() - t0; onProgress(state);
    return { ort, session, tokenizer, max: manifest.maxLength || 512 };
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

export async function classify(text) {
  const { ort, session, tokenizer, max } = await load();
  let ids = tokenizer.encode(String(text)).ids;
  if (ids.length > max) ids = [...ids.slice(0, max - 1), ids[ids.length - 1]];
  const n = ids.length;
  const t0 = performance.now();
  const out = await session.run({
    input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, n]),
    attention_mask: new ort.Tensor("int64", new BigInt64Array(n).fill(1n), [1, n]),
  });
  const ms = performance.now() - t0;
  const [a, b] = out[session.outputNames[0]].data; const m = Math.max(a, b);
  const score = Math.exp(b - m) / (Math.exp(a - m) + Math.exp(b - m));
  return { score, label: score >= 0.5 ? "INJECTION" : "SAFE", ms, tokens: n, ids };
}
if (typeof window !== "undefined") window.bsBrowserClassifier = { load, classify, state };
