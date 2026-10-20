/**
 * Hybrid retrieve: keyword score + vector cosine, tenant filtered.
 * Prefer pgvector SQL when available; else rank in memory.
 * Agents only READ these chunks. Retrieval never changes ALLOW/DENY.
 */

import { config } from "../config.js";
import { embedText, cosine, tokenize } from "./embed.js";
import { listChunks, searchChunksByVector } from "./store.js";
import { isPgvectorReady } from "../db/postgres.js";

/**
 * @param {string} query
 * @param {{ k?: number, tenantId?: string }} opts
 */
export async function retrieve(query, { k = 5, tenantId = config.tenantId } = {}) {
  const qVec = embedText(query);
  const qTokens = new Set(tokenize(query));

  let candidates = await searchChunksByVector(qVec, {
    tenantId,
    limit: Math.max(k * 4, 20),
  });

  let engine = "pgvector";
  if (!candidates.length) {
    candidates = await listChunks(tenantId);
    engine = "memory";
  }

  const ranked = candidates
    .map((chunk) => {
      const vectorScore =
        chunk.vector_score != null
          ? Number(chunk.vector_score)
          : cosine(qVec, chunk.embedding || []);
      const words = tokenize(`${chunk.title} ${chunk.body}`);
      let overlap = 0;
      for (const w of words) if (qTokens.has(w)) overlap += 1;
      const keywordScore = qTokens.size ? overlap / qTokens.size : 0;
      const score = 0.65 * vectorScore + 0.35 * keywordScore;
      return { chunk, score, vectorScore, keywordScore };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return ranked.map((r, i) => ({
    rank: i + 1,
    score: Number(r.score.toFixed(4)),
    vectorScore: Number(r.vectorScore.toFixed(4)),
    keywordScore: Number(r.keywordScore.toFixed(4)),
    engine,
    pgvector: isPgvectorReady(),
    chunk_id: r.chunk.id,
    source: r.chunk.source,
    title: r.chunk.title,
    body: r.chunk.body,
    trust_level: r.chunk.trust_level,
    as_data: `<<SOURCE ${r.chunk.id} trust=${r.chunk.trust_level}>>\n${r.chunk.title}\n${r.chunk.body}\n<<END SOURCE>>`,
  }));
}

/**
 * Every claim must cite a retrieved chunk id.
 */
export function checkCitations(claims, retrieved) {
  const allowed = new Set(retrieved.map((r) => r.chunk_id));
  return claims.map((c) => ({
    ...c,
    valid: allowed.has(c.chunk_id),
  }));
}
