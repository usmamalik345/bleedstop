-- 0002: durable control plane state
-- tenants + versioned policy snapshots (what policy was live when), append only budget ledger
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id TEXT PRIMARY KEY,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_policies (
  tenant_id TEXT NOT NULL,
  policy_sha256 TEXT NOT NULL,
  source TEXT NOT NULL,
  policy JSONB NOT NULL,
  first_loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  load_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, policy_sha256)
);

CREATE TABLE IF NOT EXISTS budget_ledger (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  cluster_id TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  decision TEXT NOT NULL,
  amount_usd NUMERIC(14,6) NOT NULL,
  paid BOOLEAN NOT NULL DEFAULT FALSE,
  at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, event_id)
);
CREATE INDEX IF NOT EXISTS budget_ledger_tenant_cluster_idx ON budget_ledger (tenant_id, cluster_id);
CREATE INDEX IF NOT EXISTS budget_ledger_tenant_at_idx ON budget_ledger (tenant_id, at DESC);

-- audit log is append only: refuse UPDATE/DELETE at the database level
CREATE OR REPLACE FUNCTION bleedstop_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION bleedstop_audit_immutable();
