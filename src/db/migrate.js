/**
 * Versioned SQL migrations (src/db/migrations/NNNN_name.sql).
 *  - pg_advisory_lock so several replicas booting together apply each file exactly once
 *  - schema_migrations records version + sha256; an edited, already applied file fails boot
 *  - each file runs in its own transaction
 *   node src/db/migrate.js            (apply)   |   node src/db/migrate.js --status
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const LOCK_ID = 7314159; // arbitrary, constant per app

export function listMigrations() {
  return fs.readdirSync(DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort().map((f) => {
    const sql = fs.readFileSync(path.join(DIR, f), "utf8");
    return { version: Number(f.slice(0, 4)), name: f, sql, sha256: crypto.createHash("sha256").update(sql).digest("hex") };
  });
}

export async function runMigrations(pool) {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, sha256 TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const { rows } = await client.query("SELECT version, sha256 FROM schema_migrations");
    const done = new Map(rows.map((r) => [r.version, r.sha256]));
    for (const m of listMigrations()) {
      if (done.has(m.version)) {
        if (done.get(m.version) !== m.sha256) throw new Error(`migration ${m.name} was edited after being applied (sha256 mismatch)`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query("INSERT INTO schema_migrations (version, name, sha256) VALUES ($1,$2,$3)", [m.version, m.name, m.sha256]);
        await client.query("COMMIT");
        applied.push(m.name);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${m.name} failed: ${err.message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    client.release();
  }
  if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    if (process.argv.includes("--status")) {
      await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, sha256 TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      const { rows } = await pool.query("SELECT version, name, applied_at FROM schema_migrations ORDER BY version");
      const have = new Set(rows.map((r) => r.version));
      console.log(JSON.stringify({ applied: rows, pending: listMigrations().filter((m) => !have.has(m.version)).map((m) => m.name) }, null, 2));
    } else {
      console.log(JSON.stringify({ applied: await runMigrations(pool) }));
    }
  } finally { await pool.end(); }
}
