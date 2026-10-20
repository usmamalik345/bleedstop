/**
 * One-shot reconcile for Kubernetes CronJob.
 * Calls the Decision API over HTTP so all pods share the same in-process state
 * (or the same Redis/Postgres-backed state later).
 */

const base = process.env.BLEEDSTOP_URL || "http://bleedstop-api";

async function main() {
  console.log(`[reconcileOnce] POST ${base}/reconcile`);
  const res = await fetch(`${base}/reconcile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));

  // Refresh RAG after incidents may have been written
  await fetch(`${base}/rag/ingest`, { method: "POST" }).catch(() => {});

  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
