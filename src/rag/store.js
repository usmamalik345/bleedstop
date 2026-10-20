/**
 * RAG chunk store: memory by default, Postgres when DATABASE_URL is set.
 * When pgvector is on, also writes embedding_vec for SQL similarity search.
 */

import { config } from "../config.js";
import { dbEnabled, getPool, isPgvectorReady } from "../db/postgres.js";
import { toVectorLiteral } from "./vectorFormat.js";

/** @type {Map<string, object>} */
const memory = new Map();

export async function upsertChunk(chunk) {
  const row = {
    id: chunk.id,
    tenant_id: chunk.tenant_id || config.tenantId,
    source: chunk.source,
    title: chunk.title,
    body: chunk.body,
    trust_level: chunk.trust_level || "playbook",
    embedding: chunk.embedding,
  };

  memory.set(row.id, row);

  if (dbEnabled()) {
    const pool = await getPool();
    if (isPgvectorReady() && Array.isArray(row.embedding)) {
      await pool.query(
        `INSERT INTO rag_chunks
           (id, tenant_id, source, title, body, trust_level, embedding, embedding_vec)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           body = EXCLUDED.body,
           trust_level = EXCLUDED.trust_level,
           embedding = EXCLUDED.embedding,
           embedding_vec = EXCLUDED.embedding_vec,
           source = EXCLUDED.source`,
        [
          row.id,
          row.tenant_id,
          row.source,
          row.title,
          row.body,
          row.trust_level,
          row.embedding,
          toVectorLiteral(row.embedding),
        ]
      );
    } else {
      await pool.query(
        `INSERT INTO rag_chunks (id, tenant_id, source, title, body, trust_level, embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           body = EXCLUDED.body,
           trust_level = EXCLUDED.trust_level,
           embedding = EXCLUDED.embedding,
           source = EXCLUDED.source`,
        [
          row.id,
          row.tenant_id,
          row.source,
          row.title,
          row.body,
          row.trust_level,
          row.embedding,
        ]
      );
    }
  }

  return row;
}

export async function listChunks(tenantId = config.tenantId) {
  if (dbEnabled()) {
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT id, tenant_id, source, title, body, trust_level, embedding
       FROM rag_chunks WHERE tenant_id = $1`,
      [tenantId]
    );
    return rows;
  }
  return [...memory.values()].filter((c) => c.tenant_id === tenantId);
}

/**
 * Fast path: ask Postgres/pgvector for nearest chunks by cosine distance.
 * Returns [] if pgvector is off — caller falls back to JS ranking.
 */
export async function searchChunksByVector(queryEmbedding, {
  tenantId = config.tenantId,
  limit = 20,
} = {}) {
  if (!dbEnabled() || !isPgvectorReady() || !config.ragUsePgvector) {
    return [];
  }
  const pool = await getPool();
  const literal = toVectorLiteral(queryEmbedding);
  const { rows } = await pool.query(
    `SELECT id, tenant_id, source, title, body, trust_level, embedding,
            (1 - (embedding_vec <=> $1::vector)) AS vector_score
     FROM rag_chunks
     WHERE tenant_id = $2 AND embedding_vec IS NOT NULL
     ORDER BY embedding_vec <=> $1::vector
     LIMIT $3`,
    [literal, tenantId, limit]
  );
  return rows;
}

export async function resetChunks() {
  memory.clear();
  if (dbEnabled()) {
    const pool = await getPool();
    await pool.query(`DELETE FROM rag_chunks WHERE tenant_id = $1`, [
      config.tenantId,
    ]);
  }
}

export function memorySize() {
  return memory.size;
}
