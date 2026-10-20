/**
 * Postgres budget store. Off unless BUDGET_STORE=postgres and DATABASE_URL is set.
 * The default path stays memory (or Redis when REDIS_URL is set).
 *
 * Two API processes can both read "spend is $0.80" and both allow a $0.30 charge.
 * This UPDATE locks the row: the second one sees the first one's new total and stops
 * if the sum would pass the ceiling.
 */
import { dbEnabled, getPool } from "./postgres.js";
import { getTenantId } from "../tenant/context.js";
import { roundMoney } from "../utils/money.js";

export function pgBudgetEnabled() {
  return process.env.BUDGET_STORE === "postgres" && dbEnabled();
}

export async function atomicPgSpend({ clusterId, amount, ceiling }) {
  const tenantId = getTenantId();
  const delta = roundMoney(amount);
  const cap = roundMoney(ceiling);
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO cluster_spend (tenant_id, cluster_id, spend) VALUES ($1, $2, 0)
       ON CONFLICT (tenant_id, cluster_id) DO NOTHING`,
      [tenantId, clusterId]
    );
    const upd = await client.query(
      `UPDATE cluster_spend
          SET spend = spend + $3
        WHERE tenant_id = $1 AND cluster_id = $2 AND spend + $3 <= $4
        RETURNING spend`,
      [tenantId, clusterId, delta, cap]
    );
    if (!upd.rowCount) {
      const cur = await client.query(
        `SELECT spend FROM cluster_spend WHERE tenant_id = $1 AND cluster_id = $2`,
        [tenantId, clusterId]
      );
      await client.query("ROLLBACK");
      return { ok: false, spend: roundMoney(cur.rows[0]?.spend ?? 0) };
    }
    await client.query("COMMIT");
    return { ok: true, spend: roundMoney(upd.rows[0].spend) };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
