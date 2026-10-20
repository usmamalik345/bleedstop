/** Central knobs — change here, not scattered in code. */
import dotenv from "dotenv";
dotenv.config();

// Unit tests stay in memory unless you set FORCE_DB=1
const useDbInTests =
  process.env.npm_lifecycle_event === "test" && process.env.FORCE_DB !== "1";

export const config = {
  port: Number(process.env.PORT || 3000),
  unpaidCeilingUsd: Number(process.env.UNPAID_CEILING_USD || 5),
  /** Paying customers get a higher daily cluster ceiling */
  paidCeilingUsd: Number(process.env.PAID_CEILING_USD || 50),
  ghostThresholdUsd: Number(process.env.GHOST_THRESHOLD_USD || 1),
  smsVelocityMax: Number(process.env.SMS_VELOCITY_MAX || 20),
  reserveTtlMs: Number(process.env.RESERVE_TTL_MS || 60_000),
  /** Token-aware LLM pricing: USD per 1K (prompt + max output) tokens when caller sends estimatedTokens */
  llmUsdPer1kTokens: Number(process.env.LLM_USD_PER_1K_TOKENS || 0.01),
  /** Unpaid callers: one request may not exceed this many estimated tokens (token flooding) */
  llmMaxTokensUnpaid: Number(process.env.LLM_MAX_TOKENS_UNPAID || 32000),
  /** Unpaid cluster: max LLM calls per rolling 60s (retry/loop storms) */
  llmVelocityMaxPerMin: Number(process.env.LLM_VELOCITY_MAX_PER_MIN || 60),
  /** json = one structured log line per /decide (stdout) */
  logFormat: process.env.LOG_FORMAT || "text",
  reconcileIntervalMs: Number(process.env.RECONCILE_INTERVAL_MS || 30_000),

  /** Empty = memory mode. Set DATABASE_URL for real Postgres. */
  databaseUrl: useDbInTests ? "" : process.env.DATABASE_URL || "",
  redisUrl: useDbInTests ? "" : process.env.REDIS_URL || "",


  /** RAG / agents never sit on the /decide hot path */
  ragEnabled: process.env.RAG_ENABLED !== "0",
  /** template = free scripted text | ollama = local LLM | llm = OpenAI */
  agentMode: process.env.AGENT_MODE || "template",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  /** Local free LLM: https://ollama.com — default URL on your laptop */
  ollamaUrl: process.env.OLLAMA_URL || "http://127.0.0.1:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "llama3.2",
  /** Prefer SQL vector search when pgvector extension is available */
  ragUsePgvector: process.env.RAG_USE_PGVECTOR !== "0",

  /** Stripe test mode — payment.attempt protection + checkout sample */
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
  /** From Stripe Dashboard → Developers → Webhooks (or `stripe listen` CLI) */
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",

  tenantId: process.env.TENANT_ID || "local-dev",
  /** "key:tenant,key2:tenant2" — empty = auth off (local learning) */
  apiKeysRaw: process.env.BLEEDSTOP_API_KEYS || "",
  /** Slack Incoming Webhook for ghost-spend alerts */
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || "",

  /**
   * Dashboard users:
   *   DASHBOARD_USERS=admin:strong-password:admin,ops:password:operator
   * Roles: viewer < operator < admin
   * Empty = local learning mode (dashboard writes stay open).
   */
  dashboardUsersRaw:
    process.env.DASHBOARD_USERS ||
    (process.env.DASHBOARD_ADMIN_PASSWORD ? `admin:${process.env.DASHBOARD_ADMIN_PASSWORD}:admin` : ""),
  dashboardSessionSecret:
    process.env.DASHBOARD_SESSION_SECRET || "local-dev-session-secret",

  role: process.env.BLEEDSTOP_ROLE || "api", // api | reconciler | ingest
};
