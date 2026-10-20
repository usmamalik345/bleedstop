/**
 * Real Postgres connection.
 * Set DATABASE_URL to use it. Without it, app stays in memory mode.
 */

import { config } from "../config.js";
import { runMigrations } from "./migrate.js";

let pool = null;
let ready = false;
/** True after CREATE EXTENSION vector succeeds */
let pgvectorReady = false;

export function dbEnabled() {
  return Boolean(config.databaseUrl);
}

export function isPgvectorReady() {
  return pgvectorReady;
}

/** Fall back to memory mode when Postgres is unreachable at boot. */
export function disableDatabase(reason) {
  if (!config.databaseUrl) return;
  config.databaseUrl = "";
  if (pool) {
    pool.end().catch(() => {});
    pool = null;
    poolPromise = null;
    ready = false;
  }
  pgvectorReady = false;
  if (reason) {
    console.warn(`Postgres disabled → memory mode (${reason})`);
  }
}

let poolPromise = null;
export async function getPool() {
  if (!config.databaseUrl) return null;
  if (pool && ready) return pool;
  // single flight: concurrent first callers share one pool + one migration run
  if (!poolPromise) poolPromise = createPool().catch((err) => { poolPromise = null; pool = null; throw err; });
  return poolPromise;
}

async function createPool() {
  const pg = await import("pg");
  pool = new pg.default.Pool({
    connectionString: config.databaseUrl,
    max: Number(process.env.PG_POOL_MAX || 10),
    // bounded waits: without these a connect or query on a dead socket hung forever and
    // stalled the write behind (measured: one replica stuck with 67,501 pending rows)
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 3000),
    query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS || 15000),
    idleTimeoutMillis: 30000,
  });
  pool.on("error", (err) => console.error("[pg pool]", err.message));
  // A checked out client whose socket dies emits "error"; unhandled, that kills the process
  // (measured: 2 of 3 replicas crashed when Postgres was stopped mid load).
  pool.on("connect", (c) => c.on("error", (err) => console.error("[pg client]", err.message)));
  await migrate(pool);
  ready = true;
  return pool;
}

export async function dbReady() {
  if (!config.databaseUrl) return false;
  await getPool();
  return ready;
}

async function migrate(p) {
  // Versioned migrations under an advisory lock (safe when N replicas boot at once)
  await runMigrations(p);

  // Optional: real vector column for advanced RAG (needs pgvector image)
  try {
    await p.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await p.query(`
      ALTER TABLE rag_chunks
        ADD COLUMN IF NOT EXISTS embedding_vec vector(64)
    `);
    await p.query(`
      CREATE INDEX IF NOT EXISTS rag_chunks_embedding_hnsw_idx
        ON rag_chunks
        USING hnsw (embedding_vec vector_cosine_ops)
    `);
    pgvectorReady = true;
    console.log("pgvector ready: RAG can use SQL vector search");
  } catch (err) {
    pgvectorReady = false;
    console.warn(
      `pgvector not available (${err.message}). Using in-memory cosine search. Tip: docker compose image pgvector/pgvector:pg16`
    );
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    poolPromise = null;
    ready = false;
  }
}

/** Readiness probe helper: a real round trip, bounded by timeoutMs. */
export async function pingDatabase(timeoutMs = 1000) {
  if (!config.databaseUrl) return true;
  const p = await getPool();
  return await Promise.race([
    p.query("SELECT 1").then(() => true),
    new Promise((r) => setTimeout(() => r(false), timeoutMs)),
  ]).catch(() => false);
}
