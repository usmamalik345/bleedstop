/**
 * Tiny BleedStop SDK — wrap expensive calls.
 *
 * Usage:
 *   const bs = createClient({ baseUrl: "http://localhost:3000", apiKey: "demo-key" });
 *   const result = await bs.guarded({ actorId, action: "llm.call", ... }, () => callOpenAI());
 */

export function createClient({
  baseUrl = "http://localhost:3000",
  apiKey = process.env.BLEEDSTOP_API_KEY || "",
} = {}) {
  function headers() {
    const h = { "Content-Type": "application/json" };
    if (apiKey) h["X-API-Key"] = apiKey;
    return h;
  }

  async function decide(body) {
    const res = await fetch(`${baseUrl}/decide`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "decide failed");
    return data;
  }

  /**
   * Ask BleedStop first; only run fn() on ALLOW or LIMIT.
   * On LIMIT, fn receives { limit } so you can use a cheaper model.
   */
  // Results of already-executed idempotent calls. A retry with the same
  // idempotencyKey gets the stored result instead of paying the vendor again.
  /** @type {Map<string, Promise<any>>} */
  const executed = new Map();
  const MAX_EXECUTED = 5000;

  async function guarded(request, fn) {
    const key = request.idempotencyKey;
    // Same key already running or finished → reuse its outcome (also covers
    // 50 parallel retries that arrive before the first one finishes)
    if (key && executed.has(key)) {
      const prior = await executed.get(key);
      return { ...prior, replay: true };
    }
    const op = (async () => {
      const decision = await decide({ ...request, mode: "auto" });
      // CHALLENGE means "no spend until the user proves they are human"
      if (decision.decision === "DENY" || decision.decision === "CHALLENGE") {
        return { ok: false, decision, result: null };
      }
      return { ok: true, decision, result: await fn(decision) };
    })();
    if (key) {
      executed.set(key, op);
      if (executed.size > MAX_EXECUTED) executed.delete(executed.keys().next().value);
      // Failed or denied attempts may be retried later
      op.then((r) => { if (!r.ok) executed.delete(key); }, () => executed.delete(key));
    }
    return op;
  }

  async function reconcile(body = {}) {
    const res = await fetch(`${baseUrl}/reconcile`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    return res.json();
  }

  return { decide, guarded, reconcile, baseUrl };
}
