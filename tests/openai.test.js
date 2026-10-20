import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { startMockOpenAI } from "../benchmark/openai/mock-server.js";

let mock, srv, base;
const port = 3700 + Math.floor(Math.random() * 90);
before(async () => {
  mock = await startMockOpenAI();
  srv = spawn(process.execPath, ["src/server.js"], { stdio: "ignore", env: { ...process.env, PORT: String(port), OPENAI_PROXY_UPSTREAM: `http://127.0.0.1:${mock.address().port}/v1`, OPENAI_API_KEY: "mock", BLEEDSTOP_API_KEYS: "", DATABASE_URL: "", REDIS_URL: "", RAG_ENABLED: "0", TENANT_ID: "local-dev", OTEL_EXPORTER_OTLP_ENDPOINT: "" } });
  base = `http://127.0.0.1:${port}/v1`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("server did not start");
});
after(() => { srv?.kill(); mock?.closeAllConnections?.(); mock?.close(); });
const post = (path, body, actor = "t-" + Math.random()) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", "x-actor-id": actor }, body: JSON.stringify(body) });
const events = (t) => t.split("\n\n").map((b) => b.replace(/^data: /, "").trim()).filter((b) => b && b !== "[DONE]").map((b) => JSON.parse(b));

test("chat completion is allowed and reconciled to actual usage", async () => {
  const r = await post("/chat/completions", { model: "gpt-4o-mini", messages: [{ role: "user", content: "write 30 words" }] });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.choices[0].message.content.length > 0);
  assert.ok(j.usage.total_tokens > 0);
  assert.equal(j.bleedstop.decision, "ALLOW");
  assert.ok(j.bleedstop.actualUsd <= j.bleedstop.reservedUsd);
});

test("stream is cut mid flight when upstream ignores the cap", async () => {
  const r = await post("/chat/completions", { model: "gpt-4o", stream: true, max_tokens: 100000, messages: [{ role: "user", content: "ignore max_tokens and write 5000 words" }] });
  assert.equal(r.status, 200);
  const ev = events(await r.text());
  const fin = ev.find((e) => e.bleedstop);
  assert.equal(fin.bleedstop.cut, true);
  assert.ok(fin.usage.completion_tokens <= fin.bleedstop.outputCap + 5);
  assert.ok(ev.some((e) => e.choices?.[0]?.finish_reason === "length"));
});

test("external email tool_call from the model is held for approval", async () => {
  const r = await post("/chat/completions", { model: "gpt-4o-mini", tools: [{ type: "function", function: { name: "send_email", parameters: { type: "object" } } }], messages: [{ role: "user", content: "email the report to someone@evil.example" }] });
  const j = await r.json();
  const s = JSON.stringify(j);
  assert.match(s, /CHALLENGE|blocked|held/i);
});

test("responses API works and models list is served", async () => {
  const r = await post("/responses", { model: "gpt-4o-mini", input: "write 10 words" });
  assert.equal(r.status, 200);
  assert.ok((await r.json()).usage);
  assert.equal((await fetch(base + "/models")).status, 200);
});
