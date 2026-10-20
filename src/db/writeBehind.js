/**
 * Batched write behind for hot path Postgres state (events, audit log, budget ledger,
 * cluster spend, identity graph).
 *
 * Why: the old path issued one or more serial SQL statements per /decide, and rewrote the
 * WHOLE identity graph (DELETE + re INSERT every actor) on every new actor. Under load the
 * queue grew without bound (measured: 41 of 5,200 events persisted 70 s after a 2 s burst).
 *
 * Now: rows are buffered in memory (tenant captured at enqueue time), coalesced by key for
 * last value wins tables, and flushed every PG_FLUSH_MS (default 50 ms) in ONE transaction
 * using json_to_recordset bulk statements. Durability window = one flush interval; SIGTERM
 * drains the buffer before exit. If Postgres is down the buffer is retained and retried; past
 * PG_MAX_PENDING buffered events the oldest are dropped and counted (never blocks /decide).
 */
import { getPool, dbEnabled } from "./postgres.js";
import { getTenantId } from "../tenant/context.js";

const FLUSH_MS = Number(process.env.PG_FLUSH_MS || 50);
const MAX_PENDING = Number(process.env.PG_MAX_PENDING || 200000);
const CHUNK = 5000;

let events = [];
let audits = [];
let ledger = [];
let spend = new Map();   // tenant\0cluster -> {t, c, v}
let actors = new Map();  // tenant\0actor -> {t, a, p}
let signals = new Map(); // tenant\0signal -> {t, s, o}
let labels = new Map();  // tenant\0root -> {t, r, c|null}
let meta = new Map();    // tenant\0key -> {t, k, v}

const stats = { flushes: 0, flushErrors: 0, rowsWritten: 0, dropped: 0, lastFlushMs: 0, maxFlushMs: 0, lastError: "" };
let timer = null;
let flushing = null;

const key = (t, id) => `${t}\u0000${id}`;
function arm() {
  if (!timer) { timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, FLUSH_MS); timer.unref?.(); }
}
function cap(arr) {
  if (arr.length > MAX_PENDING) { const n = arr.length - MAX_PENDING; arr.splice(0, n); stats.dropped += n; }
}

export function wbEvent(row) { if (!dbEnabled()) return; events.push({ id: row.id, t: getTenantId(), at: row.at, p: row }); cap(events); arm(); }
export function wbAudit(row) { if (!dbEnabled()) return; audits.push({ t: getTenantId(), r: row }); arm(); }
export function wbLedger(row) { if (!dbEnabled()) return; ledger.push({ ...row, t: getTenantId() }); cap(ledger); arm(); }
export function wbSpend(clusterId, v) { if (!dbEnabled()) return; const t = getTenantId(); spend.set(key(t, clusterId), { t, c: clusterId, v }); arm(); }
export function wbActor(actorId, parentId) { if (!dbEnabled()) return; const t = getTenantId(); actors.set(key(t, actorId), { t, a: actorId, p: parentId }); arm(); }
export function wbSignal(sig, owner) { if (!dbEnabled()) return; const t = getTenantId(); signals.set(key(t, sig), { t, s: sig, o: owner }); arm(); }
export function wbLabel(root, clusterId) { if (!dbEnabled()) return; const t = getTenantId(); labels.set(key(t, root), { t, r: root, c: clusterId ?? null }); arm(); }
export function wbMeta(k, v) { if (!dbEnabled()) return; const t = getTenantId(); meta.set(key(t, k), { t, k, v: String(v) }); arm(); }

export function pendingCount() {
  return events.length + audits.length + ledger.length + spend.size + actors.size + signals.size + labels.size + meta.size;
}

/** Drop buffered rows of one tenant (used by reset so a later flush cannot resurrect them). */
export function discardTenant(t) {
  events = events.filter((r) => r.t !== t);
  ledger = ledger.filter((r) => r.t !== t);
  for (const m of [spend, actors, signals, labels, meta]) for (const [k, v] of m) if (v.t === t) m.delete(k);
}

async function bulk(client, sql, rows) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await client.query(sql, [JSON.stringify(rows.slice(i, i + CHUNK))]);
  }
}

async function doFlush() {
  if (!pendingCount()) return;
  const batch = { events, audits, ledger, spend: [...spend.values()], actors: [...actors.values()], signals: [...signals.values()], labels: [...labels.values()], meta: [...meta.values()] };
  events = []; audits = []; ledger = []; spend = new Map(); actors = new Map(); signals = new Map(); labels = new Map(); meta = new Map();
  const n = batch.events.length + batch.audits.length + batch.ledger.length + batch.spend.length + batch.actors.length + batch.signals.length + batch.labels.length + batch.meta.length;
  const t0 = performance.now();
  const pool = await getPool();
  let client;
  let broken = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    if (batch.events.length) await bulk(client, `INSERT INTO events (id, tenant_id, at, payload)
      SELECT id, t, at::timestamptz, p FROM json_to_recordset($1::json) AS x(id text, t text, at text, p jsonb)
      ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`, batch.events);
    if (batch.audits.length) await bulk(client, `INSERT INTO audit_events (id, tenant_id, at, action, actor, target, before_value, after_value, meta, payload)
      SELECT r->>'id', t, (r->>'at')::timestamptz, r->>'action', COALESCE(r->>'actor','system'), r->>'target', r->>'before', r->>'after', COALESCE(r->'meta','{}'::jsonb), r
      FROM json_to_recordset($1::json) AS x(t text, r jsonb) ON CONFLICT (id) DO NOTHING`, batch.audits);
    if (batch.ledger.length) await bulk(client, `INSERT INTO budget_ledger (event_id, tenant_id, cluster_id, actor_id, action, decision, amount_usd, paid, at)
      SELECT event_id, t, cluster_id, actor_id, action, decision, amount_usd, paid, at::timestamptz
      FROM json_to_recordset($1::json) AS x(event_id text, t text, cluster_id text, actor_id text, action text, decision text, amount_usd numeric, paid boolean, at text)
      ON CONFLICT (tenant_id, event_id) DO NOTHING`, batch.ledger);
    if (batch.spend.length) await bulk(client, `INSERT INTO cluster_spend (tenant_id, cluster_id, spend)
      SELECT t, c, v FROM json_to_recordset($1::json) AS x(t text, c text, v numeric)
      ON CONFLICT (tenant_id, cluster_id) DO UPDATE SET spend = EXCLUDED.spend`, batch.spend);
    if (batch.actors.length) await bulk(client, `INSERT INTO cluster_actors (tenant_id, actor_id, parent_id)
      SELECT t, a, p FROM json_to_recordset($1::json) AS x(t text, a text, p text)
      ON CONFLICT (tenant_id, actor_id) DO UPDATE SET parent_id = EXCLUDED.parent_id`, batch.actors);
    if (batch.signals.length) await bulk(client, `INSERT INTO cluster_signals (tenant_id, signal_key, owner_actor_id)
      SELECT t, s, o FROM json_to_recordset($1::json) AS x(t text, s text, o text)
      ON CONFLICT (tenant_id, signal_key) DO UPDATE SET owner_actor_id = EXCLUDED.owner_actor_id`, batch.signals);
    const up = batch.labels.filter((l) => l.c != null), del = batch.labels.filter((l) => l.c == null);
    if (up.length) await bulk(client, `INSERT INTO cluster_labels (tenant_id, root_actor_id, cluster_id)
      SELECT t, r, c FROM json_to_recordset($1::json) AS x(t text, r text, c text)
      ON CONFLICT (tenant_id, root_actor_id) DO UPDATE SET cluster_id = EXCLUDED.cluster_id`, up);
    if (del.length) await bulk(client, `DELETE FROM cluster_labels l USING json_to_recordset($1::json) AS x(t text, r text)
      WHERE l.tenant_id = x.t AND l.root_actor_id = x.r`, del);
    if (batch.meta.length) await bulk(client, `INSERT INTO app_meta (tenant_id, key, value)
      SELECT t, k, v FROM json_to_recordset($1::json) AS x(t text, k text, v text)
      ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`, batch.meta);
    await client.query("COMMIT");
    stats.flushes++; stats.rowsWritten += n;
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => { broken = true; });
    stats.flushErrors++; stats.lastError = err.message;
    console.error("[writeBehind] flush failed, retrying:", err.message);
    // put rows back (newer values already buffered win for keyed maps)
    events = batch.events.concat(events); audits = batch.audits.concat(audits); ledger = batch.ledger.concat(ledger);
    cap(events); cap(ledger);
    for (const [m, rows, id] of [[spend, batch.spend, "c"], [actors, batch.actors, "a"], [signals, batch.signals, "s"], [labels, batch.labels, "r"], [meta, batch.meta, "k"]]) {
      for (const r of rows) { const k = key(r.t, r[id]); if (!m.has(k)) m.set(k, r); }
    }
    throw err;
  } finally {
    client?.release(broken || undefined);
    const ms = performance.now() - t0;
    stats.lastFlushMs = ms; stats.maxFlushMs = Math.max(stats.maxFlushMs, ms);
    if (pendingCount()) arm();
  }
}

export function flush() {
  if (flushing) return flushing.then(() => (pendingCount() ? flush() : undefined));
  flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}

/** Drain everything (shutdown, reset). Gives up after timeoutMs. */
export async function drain(timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  while ((pendingCount() || flushing) && Date.now() < end) {
    try { await flush(); } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  return pendingCount();
}

export function writeBehindStats() { return { ...stats, pending: pendingCount(), flushIntervalMs: FLUSH_MS }; }

export function renderWriteBehindMetrics() {
  if (!dbEnabled()) return "";
  const s = writeBehindStats();
  return [
    "# TYPE bleedstop_pg_pending_rows gauge", `bleedstop_pg_pending_rows ${s.pending}`,
    "# TYPE bleedstop_pg_flushes_total counter", `bleedstop_pg_flushes_total ${s.flushes}`,
    "# TYPE bleedstop_pg_flush_errors_total counter", `bleedstop_pg_flush_errors_total ${s.flushErrors}`,
    "# TYPE bleedstop_pg_rows_written_total counter", `bleedstop_pg_rows_written_total ${s.rowsWritten}`,
    "# TYPE bleedstop_pg_dropped_rows_total counter", `bleedstop_pg_dropped_rows_total ${s.dropped}`,
    "# TYPE bleedstop_pg_last_flush_ms gauge", `bleedstop_pg_last_flush_ms ${s.lastFlushMs.toFixed(2)}`,
    "",
  ].join("\n");
}
