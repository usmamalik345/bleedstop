/**
 * BleedStop HTTP API + dashboard.
 * Hot path: /decide (deterministic).
 * Off path: reconcile, RAG, agents.
 */

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { decide } from "./decision.js";
import { validateDecide } from "./validate.js";
import { take as rateTake } from "./rateLimit.js";
import { withSpan, initTracing } from "./tracing.js";
import { getPolicy, describePolicy } from "./policy.js";
import { precheckAgentCall } from "./agentGuard.js";
import { recordAudit } from "./auditLog.js";
import { listSpend, listReservations, UNPAID_CEILING_USD, PAID_CEILING_USD } from "./ledger.js";
import { listClusters } from "./cluster.js";
import { listAppKeySpend } from "./keyLedger.js";
import {
  listVendorUsage,
  listKeyStatus,
  recordVendorUsage,
  enableKey,
} from "./vendorMock.js";
import { reconcile, GHOST_THRESHOLD_USD } from "./reconciler.js";
import { listIncidents, getIncident } from "./incidents.js";
import { listEvents } from "./eventLog.js";
import { listPrices } from "./priceCatalog.js";
import {
  listRules,
  setRuleMode,
  listProposals,
  approveProposal,
} from "./rules/store.js";
import { backtestRule } from "./rules/backtester.js";
import { investigate, morningReport } from "./investigator.js";
import { resetAll } from "./resetAll.js";
import { ingestKnowledgeBase } from "./rag/ingest.js";
import { retrieve } from "./rag/retrieve.js";
import { memorySize } from "./rag/store.js";
import { runWiringAgent } from "./agents/wiringAgent.js";
import { runRuleAgent } from "./agents/ruleAgent.js";
import { dbEnabled, dbReady, isPgvectorReady, pingDatabase } from "./db/postgres.js";
import { renderWriteBehindMetrics, writeBehindStats } from "./db/writeBehind.js";
import { redisEnabled, getRedis } from "./db/redis.js";
import { hydrateFromDatabase } from "./db/hydrate.js";
import { flushPersist } from "./db/persistQueue.js";
import {
  verifyStripeSignature,
  handleStripeEvent,
  isStripeWebhookConfigured,
} from "./vendors/stripeWebhook.js";
import { requireApiKey, apiKeysEnabled } from "./auth/apiKeys.js";
import {
  currentDashboardUser,
  dashboardAuthStatus,
  loginDashboard,
  logoutDashboard,
  requireDashboardRole,
} from "./auth/dashboardAuth.js";
import { getTenantId } from "./tenant/context.js";
import { slackEnabled } from "./notify/slack.js";
import { renderPrometheus, snapshot as metricsSnapshot } from "./metrics.js";
import { listAudits } from "./auditLog.js";
import { pdfCoverage } from "./pdfCoverage.js";
import { billShockAudit } from "./audit/billShock.js";
import { runDrill } from "./drill/scenarios.js";
import { fallbackDecision, FAIL_POLICY } from "./failPolicy.js";
import {
  freezeOtp,
  unfreezeOtp,
  disableVendorKey,
  enableVendorKey,
  listRunbooks,
} from "./runbooks.js";
import { queueStats, drain, replayDead } from "./queue/memoryQueue.js";
import { ollamaReachable } from "./agents/ollama.js";
import { isLiveOpenAIEnabled } from "./vendors/openaiLive.js";


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

let bootDone = false;
let draining = false;
const app = express();
app.use((_req, res, next) => { if (draining) res.set("Connection", "close"); next(); });

// Stripe needs raw body for signature check — must be before express.json()
app.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json" }),
  (req, res) => {
    if (!isStripeWebhookConfigured()) {
      return res.status(503).json({ error: "STRIPE_WEBHOOK_SECRET not set in .env" });
    }
    const sig = req.headers["stripe-signature"];
    const raw = req.body?.toString?.("utf8") ?? "";
    if (!verifyStripeSignature(raw, sig, config.stripeWebhookSecret)) {
      return res.status(400).json({ error: "Invalid Stripe signature" });
    }
    try {
      const event = JSON.parse(raw);
      res.json(handleStripeEvent(event));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "256kb" }));

app.get("/auth/me", (req, res) => {
  res.json({
    auth: dashboardAuthStatus(),
    user: currentDashboardUser(req),
  });
});

app.post("/auth/login", (req, res) => {
  const login = loginDashboard(req.body ?? {});
  if (!login) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  res.setHeader("Set-Cookie", login.cookie);
  res.json({ ok: true, user: login.user });
});

app.post("/auth/logout", (req, res) => {
  logoutDashboard(req, res);
  res.json({ ok: true });
});

app.use(requireApiKey);

// Audit every admin/operator mutation (who, what, tenant, result). Hot path excluded.
app.use((req, res, next) => {
  const p = req.path || "";
  if (req.method === "GET" || p === "/decide" || p === "/agent/precheck" || p.startsWith("/auth/")) return next();
  res.on("finish", () => {
    recordAudit({
      action: `http:${req.method} ${p}`,
      actor: req.dashboardUser?.username || (req.apiKey ? "api-key" : "anonymous"),
      target: p,
      meta: { status: res.statusCode, tenantId: req.tenantId || getTenantId(), ip: req.ip },
    });
  });
  next();
});
app.use(express.static(publicDir));

app.get("/api/health", async (_req, res) => {
  let redisOk = false;
  if (redisEnabled()) {
    try {
      const r = await getRedis();
      redisOk = Boolean(r);
    } catch {
      redisOk = false;
    }
  }
  res.json({
    name: "BleedStop",
    role: config.role,
    message: "Money guard is running. POST /decide before you spend.",
    unpaidCeilingUsd: UNPAID_CEILING_USD,
    paidCeilingUsd: PAID_CEILING_USD,
    ghostThresholdUsd: GHOST_THRESHOLD_USD,
    dashboard: "/dashboard/",
    storage: dbEnabled() ? "postgres" : "memory",
    infra: {
      postgres: dbEnabled() ? await dbReady() : false,
      redis: redisOk,
      stripeWebhook: isStripeWebhookConfigured(),
      apiKeys: apiKeysEnabled(),
      slack: slackEnabled(),
      ragChunksMemory: memorySize(),
      ragEnabled: config.ragEnabled,
      pgvector: isPgvectorReady(),
      agentMode: config.agentMode,
      tenantId: getTenantId(),
    },
    metrics: metricsSnapshot(),
  });
});

/**
 * Kubernetes probes.
 *  /livez  : process is up and the event loop answers (no dependency checks, so a Redis or
 *            Postgres blip never triggers a restart storm)
 *  /readyz : 503 while booting or while draining after SIGTERM. Postgres and Redis outages do
 *            NOT fail readiness by default: /decide keeps answering (Redis degrades to local
 *            mode, Postgres writes are buffered by the write behind and retried). Failing
 *            readiness there would turn a database blip into a full /decide outage.
 *            READY_REQUIRES_PG=1 opts into the strict behaviour.
 */
app.get("/livez", (_req, res) => res.json({ ok: true }));
app.get("/readyz", async (_req, res) => {
  if (!bootDone || draining) return res.status(503).json({ ready: false, reason: draining ? "draining" : "booting" });
  const pg = dbEnabled() ? await pingDatabase(1000) : null;
  if (pg === false && process.env.READY_REQUIRES_PG === "1") return res.status(503).json({ ready: false, reason: "postgres unreachable" });
  res.json({ ready: true, storage: dbEnabled() ? "postgres" : "memory", postgresReachable: pg, writeBehind: dbEnabled() ? writeBehindStats() : null });
});

/** Prometheus scrape target */
app.get("/metrics", (_req, res) => {
  res.type("text/plain; version=0.0.4; charset=utf-8");
  res.send(renderPrometheus() + renderWriteBehindMetrics());
});

app.get("/audits", (req, res) => {
  res.json({ audits: listAudits({ limit: Number(req.query.limit || 50) }) });
});

/** Chart-friendly aggregates for the operator dashboard */
app.get("/api/stats", (_req, res) => {
  const spendByCluster = listSpend();
  const events = listEvents({ limit: 200 });
  const decisions = { ALLOW: 0, LIMIT: 0, DENY: 0 };
  for (const e of events) {
    const d = e.decision || e.payload?.decision;
    if (d && decisions[d] !== undefined) decisions[d] += 1;
  }
  const clusters = Object.entries(spendByCluster)
    .map(([id, spend]) => ({ id, spend: Number(spend) || 0 }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 8);

  res.json({
    tenantId: getTenantId(),
    unpaidCeilingUsd: UNPAID_CEILING_USD,
    paidCeilingUsd: PAID_CEILING_USD,
    clusters,
    decisions,
    incidentCount: listIncidents().length,
    checkedAt: new Date().toISOString(),
  });
});

app.get("/", (_req, res) => {
  res.redirect("/dashboard/");
});

app.post("/decide", async (req, res) => {
  const t0 = performance.now();
  const tenantId = getTenantId();
  // 1) protect the control plane itself
  const policy = getPolicy(tenantId);
  const rl = rateTake(`${tenantId}:${req.apiKey ? "k:" + String(req.apiKey).slice(0, 8) : "ip:" + req.ip}`, policy.decideRatePerSec, policy.decideBurst);
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfterSec));
    return res.status(429).json({ error: "decide rate limit", code: "BLEEDSTOP_DECIDE_RATE_LIMIT" });
  }
  // 2) strict input validation before touching state
  const v = validateDecide(req.body);
  if (!v.ok) return res.status(400).json({ error: "invalid request", code: "BLEEDSTOP_INVALID", details: v.errors });

  try {
    const result = await withSpan(
      "bleedstop.decide",
      {
        "bleedstop.tenant_id": tenantId,
        "bleedstop.action": v.value.action,
        "bleedstop.paid": Boolean(v.value.paid),
        "bleedstop.mode": v.value.mode || "auto",
        "bleedstop.estimated_tokens": v.value.estimatedTokens ?? -1,
      },
      async (span) => {
        const r = await decide(v.value);
        span.setAttributes({
          "bleedstop.decision": r.decision,
          "bleedstop.cluster_id": r.clusterId || "",
          "bleedstop.estimated_cost_usd": Number(r.estimatedCost ?? 0),
          "bleedstop.rule_ids": (r.matchedRules || []).map((m) => m.ruleId).join(","),
          "bleedstop.shadow_rule_ids": (r.shadowHits || []).map((m) => m.ruleId).join(","),
          "bleedstop.replay": Boolean(r.replay),
          "bleedstop.agent_verdict": r.agentCheck?.verdict || "none",
        });
        return r;
      }
    );
    res.json({ ...result, tenantId });
    if (config.logFormat === "json") {
      process.stdout.write(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "info",
          msg: "decide",
          instance: process.env.INSTANCE_ID || undefined,
          tenantId,
          decision: result.decision,
          action: result.action ?? v.value.action,
          clusterId: result.clusterId,
          estimatedCost: result.estimatedCost ?? null,
          ruleIds: (result.matchedRules || []).map((m) => m.ruleId),
          replay: Boolean(result.replay),
          latencyMs: Math.round((performance.now() - t0) * 1000) / 1000,
        }) + "\n"
      );
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Agent pre-check without spend (for agent frameworks that only want the verdict). */
app.post("/agent/precheck", (req, res) => {
  const b = req.body ?? {};
  const v = validateDecide({ actorId: "precheck", action: "auth.login", agent: b });
  if (!v.ok) return res.status(400).json({ error: "invalid request", details: v.errors });
  res.json(precheckAgentCall({ ...b, useClassifier: Boolean(b.useClassifier) }, getPolicy()));
});

/** Effective policy for the caller's tenant (admin only; no secrets in policy). */
app.get("/policy", requireDashboardRole("admin"), (_req, res) => {
  res.json({ tenantId: getTenantId(), effective: getPolicy(), ...describePolicy() });
});

app.get("/ledger", (_req, res) => {
  res.json({
    unpaidCeilingUsd: UNPAID_CEILING_USD,
    paidCeilingUsd: PAID_CEILING_USD,
    spendByCluster: listSpend(),
    reservations: listReservations(),
    clusters: listClusters(),
    appSpendByKey: listAppKeySpend(),
    vendorUsageByKey: listVendorUsage(),
    keyStatus: listKeyStatus(),
  });
});

app.post("/ledger/reset", requireDashboardRole("admin"), async (_req, res) => {
  await resetAll();
  if (config.ragEnabled) {
    // Missing KB files must not crash the process (unhandled rejection)
    try {
      await ingestKnowledgeBase();
    } catch (err) {
      console.warn("RAG re-ingest skipped:", err.message);
    }
  }
  res.json({
    ok: true,
    message: "Full state cleared; KB re-ingested.",
    storage: dbEnabled() ? "postgres" : "memory",
  });
});


app.post("/demo/leak-spend", requireDashboardRole("operator"), (req, res) => {
  const { keyId = "gm-demo-key", dollars = 5 } = req.body ?? {};
  const amount = Number(dollars);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "dollars must be a positive number" });
  }
  const result = recordVendorUsage(keyId, amount);
  if (!result.ok) return res.status(403).json(result);
  res.json({
    ok: true,
    message: "Leaked-key spend on vendor bill only (not in app ledger).",
    keyId,
    added: amount,
    vendorTotal: result.total,
  });
});

app.post("/reconcile", requireDashboardRole("operator"), (req, res) => {
  const { keyId, autoKill = true } = req.body ?? {};
  res.json(reconcile({ keyId, autoKill: Boolean(autoKill) }));
});

app.get("/incidents", (_req, res) => {
  res.json({ incidents: listIncidents() });
});

app.get("/incidents/:id", (req, res) => {
  const incident = getIncident(req.params.id);
  if (!incident) return res.status(404).json({ error: "not found" });
  res.json(incident);
});

app.get("/events", (req, res) => {
  res.json({ events: listEvents({ limit: Number(req.query.limit || 100) }) });
});

app.get("/prices", (_req, res) => {
  res.json({ prices: listPrices() });
});

app.get("/rules", (_req, res) => {
  res.json({ rules: listRules(), proposals: listProposals() });
});

app.post("/rules/:id/mode", requireDashboardRole("operator"), (req, res) => {
  try {
    const actor =
      req.headers["x-operator"] ||
      req.body?.actor ||
      "dashboard";
    res.json(setRuleMode(req.params.id, req.body?.mode, { actor }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/rules/backtest", requireDashboardRole("operator"), (req, res) => {
  res.json(backtestRule(req.body?.rule ?? {}, { days: req.body?.days ?? 30 }));
});

app.post("/proposals/:id/approve", requireDashboardRole("operator"), (req, res) => {
  try {
    res.json(approveProposal(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/investigate", async (req, res) => {
  res.json(await investigate(req.query.incidentId));
});

app.get("/report/morning", (_req, res) => {
  res.json(morningReport());
});

app.post("/keys/:id/enable", requireDashboardRole("operator"), (req, res) => {
  res.json(enableKey(req.params.id));
});

/** RAG */
app.post("/rag/ingest", requireDashboardRole("admin"), async (_req, res) => {
  try {
    res.json(await ingestKnowledgeBase());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/rag/search", async (req, res) => {
  const q = String(req.query.q || "");
  if (!q) return res.status(400).json({ error: "q required" });
  res.json({ query: q, results: await retrieve(q, { k: Number(req.query.k || 5) }) });
});

/** Learning / ops: is vector DB + local LLM ready? */
app.get("/rag/status", async (_req, res) => {
  const ollama = await ollamaReachable();
  res.json({
    ragEnabled: config.ragEnabled,
    postgres: dbEnabled(),
    pgvector: isPgvectorReady(),
    agentMode: config.agentMode,
    ollama: {
      reachable: ollama,
      url: config.ollamaUrl,
      model: config.ollamaModel,
    },
    openai: {
      configured: isLiveOpenAIEnabled(),
      model: config.openaiModel,
    },
    tip: !isPgvectorReady()
      ? "Recreate Postgres with pgvector image: docker compose down; docker volume rm; npm run db:up"
      : ollama
        ? "Set AGENT_MODE=ollama and restart npm start for local LLM summaries"
        : "Install Ollama, run: ollama pull llama3.2",
  });
});

/** Agents (explicit, never on /decide) */
app.post("/agents/rules", requireDashboardRole("operator"), async (req, res) => {
  res.json(await runRuleAgent(req.body?.incidentId));
});

app.post("/agents/wiring", requireDashboardRole("admin"), async (_req, res) => {
  res.json(await runWiringAgent());
});

/** PDF flows you can run locally */
app.get("/pdf/coverage", (_req, res) => {
  res.json(pdfCoverage());
});

app.get("/fail-policy", (_req, res) => {
  res.json({ policy: FAIL_POLICY });
});

app.get("/fail-policy/:action", (req, res) => {
  res.json(fallbackDecision(req.params.action));
});

app.get("/audit/bill-shock", (_req, res) => {
  res.json(billShockAudit());
});

app.post("/drill/run", requireDashboardRole("operator"), async (_req, res) => {
  try {
    res.json(await runDrill());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/runbooks", (_req, res) => {
  res.json(listRunbooks());
});

app.post("/runbooks/otp-freeze", requireDashboardRole("operator"), (req, res) => {
  try {
    res.json(freezeOtp(req.body?.clusterId, { actor: req.body?.actor || "dashboard" }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/runbooks/otp-unfreeze", requireDashboardRole("operator"), (req, res) => {
  try {
    res.json(unfreezeOtp(req.body?.clusterId, { actor: req.body?.actor || "dashboard" }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/runbooks/disable-key", requireDashboardRole("operator"), (req, res) => {
  try {
    res.json(disableVendorKey(req.body?.keyId, { actor: req.body?.actor || "dashboard" }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/runbooks/enable-key", requireDashboardRole("operator"), (req, res) => {
  try {
    res.json(enableVendorKey(req.body?.keyId, { actor: req.body?.actor || "dashboard" }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/queue", async (_req, res) => {
  const drained = await drain(async () => {});
  res.json(drained);
});

app.post("/queue/replay-dead", requireDashboardRole("operator"), (_req, res) => {
  res.json(replayDead());
});

app.get("/queue/stats", (_req, res) => {
  res.json(queueStats());
});

async function boot() {
  try {
    const hydrated = await hydrateFromDatabase();
    if (hydrated.loaded) {
      console.log(`Postgres hydrated:`, hydrated.counts);
    } else {
      console.log("Storage mode: memory (set DATABASE_URL for real Postgres)");
    }
  } catch (err) {
    if (process.env.PG_REQUIRED === "1") {
      // durable mode: never silently run without Postgres; let the orchestrator restart us
      console.error(`Postgres required (PG_REQUIRED=1) but unavailable: ${err.message}`);
      process.exit(1);
    }
    const { disableDatabase } = await import("./db/postgres.js");
    disableDatabase(err.message);
    console.warn(
      "Tip: start Docker + npm run db:up for real Postgres, or remove DATABASE_URL from .env"
    );
  }

  await initTracing();
  if (config.ragEnabled) {
    try {
      const result = await ingestKnowledgeBase();
      console.log(`RAG ready: ${result.total} chunks`);
    } catch (err) {
      console.warn("RAG ingest skipped:", err.message);
    }
  }

  const server = app.listen(config.port, () => {
    bootDone = true;
    console.log(`BleedStop on http://localhost:${config.port}`);
    console.log(`Dashboard  http://localhost:${config.port}/dashboard/`);
    console.log(
      `Ceilings unpaid $${UNPAID_CEILING_USD} / paid $${PAID_CEILING_USD} | Ghost ≥ $${GHOST_THRESHOLD_USD} | RAG=${config.ragEnabled}`
    );
    console.log(
      `Storage=${dbEnabled() ? "postgres" : "memory"} redis=${redisEnabled()} role=${config.role}`
    );
  });

  // Keep alive sockets must outlive the LB/kube-proxy idle timeout, or the client reuses a
  // socket the server just closed (ECONNRESET under load).
  server.keepAliveTimeout = Number(process.env.KEEPALIVE_TIMEOUT_MS || 65000);
  server.headersTimeout = server.keepAliveTimeout + 1000;

  // Graceful shutdown: fail readiness, wait for endpoints to drop this pod, stop accepting,
  // finish in flight requests, flush Postgres write behind, exit.
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    draining = true;
    const drainMs = Number(process.env.SHUTDOWN_DRAIN_MS || 0);
    if (drainMs) await new Promise((r) => setTimeout(r, drainMs));
    server.close();
    // tell keep alive clients to reconnect elsewhere instead of resetting their sockets
    server.closeIdleConnections?.();
    const hard = setTimeout(() => process.exit(0), Number(process.env.SHUTDOWN_TIMEOUT_MS || 10000));
    hard.unref();
    await flushPersist();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// On Vercel the platform owns the HTTP server: export the app and skip listen().
if (process.env.VERCEL) {
  bootDone = true;
} else {
  boot();
}

export { app };
export default app;

