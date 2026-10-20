// HTTP server speaking the OpenAI Chat Completions / Responses wire format, backed by the deterministic mock.
import http from "node:http";
import { mockChat, mockResponses } from "../../src/openai/mockUpstream.js";
export function startMockOpenAI(port = 0) {
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", async () => {
      const body = JSON.parse(b || "{}");
      const out = req.url.endsWith("/responses") ? mockResponses(body) : mockChat(body);
      if (out.json) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(out.json)); }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      let closed = false; res.on("close", () => (closed = true));
      for await (const ev of out.stream) { if (closed) break; res.write(`data: ${JSON.stringify(ev)}\n\n`); }
      if (!closed) res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return new Promise((r) => srv.listen(port, "127.0.0.1", () => r(srv)));
}
if (import.meta.url === `file://${process.argv[1]}`) startMockOpenAI(Number(process.env.PORT || 4010)).then((s) => console.log("mock openai on", s.address().port));
