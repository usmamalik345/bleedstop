/**
 * Reconciler worker — runs on a timer (K8s CronJob / Deployment).
 * Not on the /decide hot path.
 */

import { config } from "../config.js";
import { reconcile } from "../reconciler.js";
import { ingestKnowledgeBase } from "../rag/ingest.js";

async function tick() {
  try {
    const report = reconcile({});
    const ghosts = report.results.filter((r) => r.ghostDetected);
    console.log(
      `[reconciler] checked=${report.results.length} ghosts=${ghosts.length}`
    );
    if (ghosts.length) {
      // Refresh RAG with new incidents
      await ingestKnowledgeBase();
    }
  } catch (err) {
    console.error("[reconciler] error:", err.message);
  }
}

async function main() {
  console.log(
    `BleedStop reconciler worker starting (every ${config.reconcileIntervalMs}ms)`
  );
  await ingestKnowledgeBase().catch(() => {});
  await tick();
  setInterval(tick, config.reconcileIntervalMs);
}

main();
