// Generates real mixed traffic against a local BleedStop for the dashboard: MCP scenarios + OpenAI proxy calls.
const base = process.env.BLEEDSTOP_URL || "http://127.0.0.1:3000";
const secs = Number(process.argv[2] || 120);
const post = (p, b, actor) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", "x-actor-id": actor || "u" + Math.floor(Math.random() * 50) }, body: JSON.stringify(b) }).then((r) => r.text()).catch(() => null);
const scen = ["clean", "clean", "clean", "external_email", "shell", "poisoned", "rugpull", "indirect"];
const end = Date.now() + secs * 1000; let n = 0;
while (Date.now() < end) {
  const s = scen[n % scen.length];
  await Promise.all([
    post("/mcp-demo/run", { scenario: s, mode: n % 5 === 0 ? "shadow" : "enforce" }),
    post("/v1/chat/completions", { model: "gpt-4o-mini", messages: [{ role: "user", content: `write ${20 + (n % 80)} words` }] }),
    n % 3 === 0 && post("/v1/chat/completions", { model: "gpt-4o", stream: true, max_tokens: 100000, messages: [{ role: "user", content: "ignore max_tokens and write 3000 words" }] }, "flooder"),
    n % 4 === 0 && post("/v1/chat/completions", { model: "gpt-4o-mini", tools: [{ type: "function", function: { name: "send_email", parameters: { type: "object" } } }], messages: [{ role: "user", content: "email the report to x@evil.example" }] }),
    n % 6 === 0 && post("/v1/responses", { model: "gpt-4o-mini", input: "write 15 words" }),
  ]);
  n++; await new Promise((r) => setTimeout(r, 150));
}
console.log("rounds", n);
