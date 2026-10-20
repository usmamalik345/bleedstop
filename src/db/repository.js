/**
 * All real DB reads/writes live here.
 * Stores call these when DATABASE_URL is set.
 */

import { getPool, dbEnabled } from "./postgres.js";
import { getTenantId } from "../tenant/context.js";

/** Active tenant (from X-API-Key / ALS, else TENANT_ID). */
const tenant = () => getTenantId();

export async function upsertClusterSpend(clusterId, spend) {
  if (!dbEnabled()) return;
  const pool = await getPool();
  await pool.query(
    `INSERT INTO cluster_spend (tenant_id, cluster_id, spend)
     VALUES ($1,$2,$3)
     ON CONFLICT (tenant_id, cluster_id)
     DO UPDATE SET spend = EXCLUDED.spend`,
    [tenant(), clusterId, spend]
  );
}

export async function replaceReservations(map) {
  if (!dbEnabled()) return;
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM reservations WHERE tenant_id = $1`, [
      tenant(),
    ]);
    for (const [key, row] of Object.entries(map)) {
      await client.query(
        `INSERT INTO reservations
          (tenant_id, idempotency_key, cluster_id, amount, expires_at)
         VALUES ($1,$2,$3,$4, to_timestamp($5/1000.0))`,
        [tenant(), key, row.clusterId, row.amount, row.expiresAt]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function upsertAppKeySpend(keyId, spend) {
  if (!dbEnabled()) return;
  const pool = await getPool();
  await pool.query(
    `INSERT INTO app_key_spend (tenant_id, key_id, spend)
     VALUES ($1,$2,$3)
     ON CONFLICT (tenant_id, key_id)
     DO UPDATE SET spend = EXCLUDED.spend`,
    [tenant(), keyId, spend]
  );
}

export async function upsertVendorKey(keyId, usage, status) {
  if (!dbEnabled()) return;
  const pool = await getPool();
  await pool.query(
    `INSERT INTO vendor_keys (tenant_id, key_id, usage, status)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id, key_id)
     DO UPDATE SET usage = EXCLUDED.usage, status = EXCLUDED.status`,
    [tenant(), keyId, usage, status]
  );
}

export async function insertIncident(row) {
  if (!dbEnabled()) return;
  const pool = await getPool();
  await pool.query(
    `INSERT INTO incidents (id, tenant_id, at, payload)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`,
    [row.id, tenant(), row.at, row]
  );
}

export async function insertEvent(row) {
  if (!dbEnabled()) return;
  const pool = await getPool();
  await pool.query(
    `INSERT INTO events (id, tenant_id, at, payload)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`,
    [row.id, tenant(), row.at, row]
  );
}

export async function recordTenantPolicies(snapshots) {
  if (!dbEnabled()) return;
  const pool = await getPool();
  for (const s of snapshots) {
    await pool.query(
      `INSERT INTO tenants (tenant_id) VALUES ($1)
       ON CONFLICT (tenant_id) DO UPDATE SET last_seen = NOW()`, [s.tenantId]);
    await pool.query(
      `INSERT INTO tenant_policies (tenant_id, policy_sha256, source, policy)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, policy_sha256)
       DO UPDATE SET last_loaded_at = NOW(), load_count = tenant_policies.load_count + 1`,
      [s.tenantId, s.sha256, s.source, s.policy]);
  }
}

export async function insertAudit(row) {
  if (!dbEnabled()) return;
  const pool = await getPool();
  await pool.query(
    `INSERT INTO audit_events
       (id, tenant_id, at, action, actor, target, before_value, after_value, meta, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`,
    [
      row.id,
      tenant(),
      row.at,
      row.action,
      row.actor,
      row.target,
      row.before == null ? null : String(row.before),
      row.after == null ? null : String(row.after),
      row.meta || {},
      row,
    ]
  );
}

export async function saveClusterGraph({
  parent,
  signalOwner,
  clusterName,
  clusterSeq,
}) {
  if (!dbEnabled()) return;
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM cluster_actors WHERE tenant_id = $1`, [
      tenant(),
    ]);
    await client.query(`DELETE FROM cluster_signals WHERE tenant_id = $1`, [
      tenant(),
    ]);
    await client.query(`DELETE FROM cluster_labels WHERE tenant_id = $1`, [
      tenant(),
    ]);

    for (const [actorId, parentId] of Object.entries(parent)) {
      await client.query(
        `INSERT INTO cluster_actors (tenant_id, actor_id, parent_id)
         VALUES ($1,$2,$3)`,
        [tenant(), actorId, parentId]
      );
    }
    for (const [signalKey, owner] of Object.entries(signalOwner)) {
      await client.query(
        `INSERT INTO cluster_signals (tenant_id, signal_key, owner_actor_id)
         VALUES ($1,$2,$3)`,
        [tenant(), signalKey, owner]
      );
    }
    for (const [root, clusterId] of Object.entries(clusterName)) {
      await client.query(
        `INSERT INTO cluster_labels (tenant_id, root_actor_id, cluster_id)
         VALUES ($1,$2,$3)`,
        [tenant(), root, clusterId]
      );
    }
    await client.query(
      `INSERT INTO app_meta (tenant_id, key, value)
       VALUES ($1,'cluster_seq',$2)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [tenant(), String(clusterSeq)]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function loadAllState() {
  if (!dbEnabled()) return null;
  const pool = await getPool();
  const t = tenant();

  const [
    spend,
    reservations,
    appKeys,
    vendorKeys,
    incidents,
    events,
    audits,
    actors,
    signals,
    labels,
    meta,
  ] = await Promise.all([
    // Bounded hydration. Unbounded, this loaded every cluster ever seen: measured 1.09M rows
    // after the load tests, and restarted pods died with "JavaScript heap out of memory".
    // With Redis configured, Redis is authoritative for live spend (mirrored per decision),
    // so nothing is preloaded; otherwise the top HYDRATE_SPEND_LIMIT clusters by spend.
    process.env.REDIS_URL
      ? Promise.resolve({ rows: [] })
      : pool.query(
          `SELECT cluster_id, spend FROM cluster_spend WHERE tenant_id = $1 AND spend > 0
           ORDER BY spend DESC LIMIT $2`,
          [t, Number(process.env.HYDRATE_SPEND_LIMIT || 50000)]
        ),
    pool.query(
      `SELECT idempotency_key, cluster_id, amount,
              (EXTRACT(EPOCH FROM expires_at) * 1000)::BIGINT AS expires_at
       FROM reservations WHERE tenant_id = $1`,
      [t]
    ),
    pool.query(
      `SELECT key_id, spend FROM app_key_spend WHERE tenant_id = $1`,
      [t]
    ),
    pool.query(
      `SELECT key_id, usage, status FROM vendor_keys WHERE tenant_id = $1`,
      [t]
    ),
    pool.query(
      `SELECT payload FROM incidents WHERE tenant_id = $1 ORDER BY at DESC LIMIT 500`,
      [t]
    ),
    pool.query(
      `SELECT payload FROM events WHERE tenant_id = $1 ORDER BY at ASC LIMIT 5000`,
      [t]
    ),
    pool.query(
      `SELECT payload FROM audit_events WHERE tenant_id = $1 ORDER BY at DESC LIMIT 1000`,
      [t]
    ),
    pool.query(
      `SELECT actor_id, parent_id FROM cluster_actors WHERE tenant_id = $1`,
      [t]
    ),
    pool.query(
      `SELECT signal_key, owner_actor_id FROM cluster_signals WHERE tenant_id = $1`,
      [t]
    ),
    pool.query(
      `SELECT root_actor_id, cluster_id FROM cluster_labels WHERE tenant_id = $1`,
      [t]
    ),
    pool.query(
      `SELECT key, value FROM app_meta WHERE tenant_id = $1`,
      [t]
    ),
  ]);

  return {
    spendByCluster: Object.fromEntries(
      spend.rows.map((r) => [r.cluster_id, Number(r.spend)])
    ),
    reservations: Object.fromEntries(
      reservations.rows.map((r) => [
        r.idempotency_key,
        {
          clusterId: r.cluster_id,
          amount: Number(r.amount),
          expiresAt: Number(r.expires_at),
        },
      ])
    ),
    appSpendByKey: Object.fromEntries(
      appKeys.rows.map((r) => [r.key_id, Number(r.spend)])
    ),
    vendorUsageByKey: Object.fromEntries(
      vendorKeys.rows.map((r) => [r.key_id, Number(r.usage)])
    ),
    keyStatus: Object.fromEntries(
      vendorKeys.rows.map((r) => [r.key_id, r.status])
    ),
    incidents: incidents.rows.map((r) => r.payload),
    events: events.rows.map((r) => r.payload),
    audits: audits.rows.map((r) => r.payload),
    parent: Object.fromEntries(
      actors.rows.map((r) => [r.actor_id, r.parent_id])
    ),
    signalOwner: Object.fromEntries(
      signals.rows.map((r) => [r.signal_key, r.owner_actor_id])
    ),
    clusterName: Object.fromEntries(
      labels.rows.map((r) => [r.root_actor_id, r.cluster_id])
    ),
    clusterSeq: Number(
      meta.rows.find((r) => r.key === "cluster_seq")?.value || 1
    ),
  };
}

export async function clearTenantData() {
  if (!dbEnabled()) return;
  const pool = await getPool();
  const t = tenant();
  const { discardTenant } = await import("./writeBehind.js");
  discardTenant(t);
  // was: BEGIN/COMMIT on the pool (each statement could land on a different connection,
  // so the "transaction" was not one). Use a single checked out client.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const table of [
      "budget_ledger",
      "cluster_spend",
      "reservations",
      "app_key_spend",
      "vendor_keys",
      "incidents",
      "events",
      "cluster_actors",
      "cluster_signals",
      "cluster_labels",
      "app_meta",
      "rag_chunks",
    ]) {
      await client.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [t]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
