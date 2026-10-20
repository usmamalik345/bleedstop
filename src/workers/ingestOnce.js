/** One-shot RAG ingest via API (Helm post-install Job). */
const base = process.env.BLEEDSTOP_URL || "http://bleedstop-api";

async function main() {
  // Wait briefly for API readiness in cluster boots
  for (let i = 0; i < 30; i++) {
    try {
      const health = await fetch(`${base}/api/health`);
      if (health.ok) break;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  const res = await fetch(`${base}/rag/ingest`, { method: "POST" });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
