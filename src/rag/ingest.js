/**
 * Ingest knowledge into RAG.
 * Sources are allow-listed local files + recent incidents (never attacker tools).
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";
import { embedText } from "./embed.js";
import { upsertChunk, listChunks } from "./store.js";
import { listIncidents } from "../incidents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kbDir = path.join(__dirname, "..", "..", "data", "kb");

export async function ingestKnowledgeBase() {
  const files = ["owasp-automated-threats.json", "bleedstop-playbooks.json"];
  let count = 0;

  for (const file of files) {
    const raw = await fs.readFile(path.join(kbDir, file), "utf8");
    const docs = JSON.parse(raw);
    for (const doc of docs) {
      const body = sanitize(doc.body);
      await upsertChunk({
        id: `kb:${doc.id}`,
        tenant_id: config.tenantId,
        source: `data/kb/${file}#${doc.id}`,
        title: doc.title,
        body,
        trust_level: doc.trust_level || "playbook",
        embedding: embedText(`${doc.title}\n${body}`),
      });
      count += 1;
    }
  }

  // Index recent incidents so "similar incident" search works
  for (const incident of listIncidents().slice(0, 50)) {
    const body = sanitize(
      `${incident.type} ${incident.message || ""} rootCause=${incident.rootCause || ""} key=${incident.keyId || ""} cluster=${incident.clusterId || ""} ghost=${incident.ghostSpend || ""}`
    );
    await upsertChunk({
      id: `incident:${incident.id}`,
      tenant_id: config.tenantId,
      source: `incident:${incident.id}`,
      title: `Incident ${incident.id} (${incident.type})`,
      body,
      trust_level: "incident",
      embedding: embedText(body),
    });
    count += 1;
  }

  return { ingested: count, total: (await listChunks()).length };
}

/** Strip obvious prompt-injection style instructions from retrieved docs. */
function sanitize(text) {
  return String(text)
    .replace(/ignore (all|previous|above) instructions/gi, "[redacted-instruction]")
    .replace(/system prompt/gi, "[redacted]")
    .trim();
}
