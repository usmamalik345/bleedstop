import { test } from "node:test";
import assert from "node:assert/strict";
import { resetAll } from "../src/resetAll.js";
import { ingestKnowledgeBase } from "../src/rag/ingest.js";
import { retrieve, checkCitations } from "../src/rag/retrieve.js";
import { decide } from "../src/decision.js";
import { recordVendorUsage } from "../src/vendorMock.js";
import { reconcile } from "../src/reconciler.js";
import { investigate } from "../src/investigator.js";

test("RAG ingest + retrieve finds ghost-spend playbook", async () => {
  await resetAll();
  const result = await ingestKnowledgeBase();
  assert.ok(result.total >= 8);

  const hits = await retrieve("leaked API key ghost spend vendor bill", { k: 3 });
  assert.ok(hits.length > 0);
  assert.ok(
    hits.some((h) => /ghost|leaked|wallet|key/i.test(`${h.title} ${h.body}`))
  );
});

test("investigator cites retrieved chunks", async () => {
  await resetAll();
  await ingestKnowledgeBase();
  await decide({
    actorId: "u1",
    action: "llm.call",
    paid: true,
    vendorKeyId: "gm-demo-key",
  });
  recordVendorUsage("gm-demo-key", 15);
  reconcile({ keyId: "gm-demo-key" });
  await ingestKnowledgeBase();

  const report = await investigate();
  assert.match(report.summary, /ghost/i);
  assert.ok(report.retrieved.length > 0);
  const checked = checkCitations(report.claims, report.retrieved);
  assert.ok(checked.every((c) => c.valid));
});

