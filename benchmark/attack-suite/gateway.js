/**
 * Minimal "free-tier AI app" in front of the mock LLM.
 *   protect=false → calls upstream directly (baseline)
 *   protect=true  → SDK guarded(): asks BleedStop /decide first, honours DENY/CHALLENGE/LIMIT,
 *                   and does not re-execute a call whose idempotencyKey already ran.
 * Sends estimatedTokens (prompt + max output) so token-aware pricing can see prompt size.
 */
import express from "express";
import { createClient } from "../../src/sdk/client.js";
import { tokensOf } from "./mock-llm.js";

export function startGateway({ port, upstream, bleedstopUrl, protect }) {
  const bs = createClient({ baseUrl: bleedstopUrl });
  const callUpstream = async (prompt, max) => {
    const r = await fetch(`${upstream}/v1/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mock", max_tokens: max, messages: [{ role: "user", content: prompt }] }),
    });
    return r.json();
  };
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  app.post("/chat", async (req, res) => {
    const { actorId, email, deviceFingerprint, ip, prompt = "", maxTokens = 512, idempotencyKey } = req.body;
    if (!protect) {
      const j = await callUpstream(prompt, maxTokens);
      return res.json({ decision: "DIRECT", cost: j.cost_usd });
    }
    try {
      const g = await bs.guarded(
        {
          actorId, action: "llm.call", paid: false, vendorKeyId: "gm-demo-key", idempotencyKey,
          estimatedTokens: tokensOf(prompt) + maxTokens,
          // ip is sent for the record; BleedStop clustering does not use IP today
          signals: { email, deviceFingerprint, ip },
        },
        (d) => callUpstream(prompt, d.decision === "LIMIT" ? Math.min(maxTokens, d.limit?.maxTokens || 300) : maxTokens)
      );
      if (!g.ok) return res.status(429).json({ decision: g.decision.decision, reason: g.decision.reason });
      res.json({ decision: g.replay ? "REPLAY" : g.decision.decision, cost: g.result?.cost_usd });
    } catch (e) {
      res.status(503).json({ error: "bleedstop_unavailable", detail: e.message });
    }
  });
  return new Promise((r) => { const s = app.listen(port, () => r(s)); });
}
