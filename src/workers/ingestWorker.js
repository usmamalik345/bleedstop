/**
 * RAG ingest worker — load KB + incidents into the chunk store.
 * In Kubernetes this can be a Job/CronJob.
 */

import { ingestKnowledgeBase } from "../rag/ingest.js";
import { listChunks } from "../rag/store.js";
import { closePool } from "../db/postgres.js";

async function main() {
  console.log("BleedStop RAG ingest starting...");
  const result = await ingestKnowledgeBase();
  const chunks = await listChunks();
  console.log(`Ingested ${result.ingested} docs. Store size=${chunks.length}`);
  console.log(
    chunks
      .slice(0, 5)
      .map((c) => `- ${c.id}: ${c.title}`)
      .join("\n")
  );
  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});
