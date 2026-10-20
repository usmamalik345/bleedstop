/**
 * Deterministic mock LLM upstream (no network, no real keys).
 * Bills tokens like a real provider so the attack suite can measure $.
 * tokens = ceil(chars / 4); output tokens = min(max_tokens, MOCK_OUTPUT_TOKENS).
 */
import http from "node:http";

export const PRICE = {
  inputPerMTok: Number(process.env.MOCK_PRICE_IN_PER_MTOK || 2.5),
  outputPerMTok: Number(process.env.MOCK_PRICE_OUT_PER_MTOK || 10),
};
const OUT_TOKENS = Number(process.env.MOCK_OUTPUT_TOKENS || 200);

export const tokensOf = (s) => Math.ceil(String(s || "").length / 4);

export function startMockLlm(port) {
  const bill = { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/bill") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify(bill));
    }
    if (req.method === "POST" && req.url === "/bill/reset") {
      Object.assign(bill, { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 });
      return res.end("{}");
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = JSON.parse(body || "{}");
      const inTok = tokensOf((j.messages || []).map((m) => m.content).join(""));
      const outTok = Math.min(Number(j.max_tokens || 1024), OUT_TOKENS);
      const usd = (inTok * PRICE.inputPerMTok + outTok * PRICE.outputPerMTok) / 1e6;
      bill.calls++; bill.inputTokens += inTok; bill.outputTokens += outTok; bill.usd += usd;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "x".repeat(outTok * 4) } }],
        usage: { prompt_tokens: inTok, completion_tokens: outTok },
        cost_usd: usd,
      }));
    });
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}
