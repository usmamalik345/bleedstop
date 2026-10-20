-- 0001: original schema (was inline CREATE IF NOT EXISTS in postgres.js)
CREATE TABLE IF NOT EXISTS rag_chunks (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      trust_level TEXT NOT NULL DEFAULT 'playbook',
      embedding DOUBLE PRECISION[] NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS rag_chunks_tenant_idx ON rag_chunks (tenant_id);

    CREATE TABLE IF NOT EXISTS cluster_spend (
      tenant_id TEXT NOT NULL,
      cluster_id TEXT NOT NULL,
      spend NUMERIC(12,3) NOT NULL DEFAULT 0,
      PRIMARY KEY (tenant_id, cluster_id)
    );

    CREATE TABLE IF NOT EXISTS reservations (
      tenant_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      cluster_id TEXT NOT NULL,
      amount NUMERIC(12,3) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (tenant_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS app_key_spend (
      tenant_id TEXT NOT NULL,
      key_id TEXT NOT NULL,
      spend NUMERIC(12,3) NOT NULL DEFAULT 0,
      PRIMARY KEY (tenant_id, key_id)
    );

    CREATE TABLE IF NOT EXISTS vendor_keys (
      tenant_id TEXT NOT NULL,
      key_id TEXT NOT NULL,
      usage NUMERIC(12,3) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      PRIMARY KEY (tenant_id, key_id)
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS incidents_tenant_at_idx
      ON incidents (tenant_id, at DESC);

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_tenant_at_idx
      ON events (tenant_id, at DESC);

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      at TIMESTAMPTZ NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      target TEXT,
      before_value TEXT,
      after_value TEXT,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      payload JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_events_tenant_at_idx
      ON audit_events (tenant_id, at DESC);

    CREATE TABLE IF NOT EXISTS cluster_actors (
      tenant_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      parent_id TEXT NOT NULL,
      PRIMARY KEY (tenant_id, actor_id)
    );

    CREATE TABLE IF NOT EXISTS cluster_signals (
      tenant_id TEXT NOT NULL,
      signal_key TEXT NOT NULL,
      owner_actor_id TEXT NOT NULL,
      PRIMARY KEY (tenant_id, signal_key)
    );

    CREATE TABLE IF NOT EXISTS cluster_labels (
      tenant_id TEXT NOT NULL,
      root_actor_id TEXT NOT NULL,
      cluster_id TEXT NOT NULL,
      PRIMARY KEY (tenant_id, root_actor_id)
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      tenant_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (tenant_id, key)
    );
