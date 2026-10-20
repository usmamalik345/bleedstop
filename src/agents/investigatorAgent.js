/**
 * Investigator agent (OFF hot path).
 * Uses RAG to name the threat and attach citations.
 * Modes:
 *   template — free scripted English (default, no install)
 *   ollama   — local free LLM (needs Ollama running)
 *   llm      — OpenAI (needs OPENAI_API_KEY)
 */

import { retrieve, checkCitations } from "../rag/retrieve.js";
import { getIncident, listIncidents } from "../incidents.js";
import { listSpend } from "../ledger.js";
import { listClusters } from "../cluster.js";
import { listAppKeySpend } from "../keyLedger.js";
import { listVendorUsage, listKeyStatus } from "../vendorMock.js";
import { formatUsd } from "../utils/money.js";
import { config } from "../config.js";
import { ollamaReachable, summarizeWithOllama } from "./ollama.js";
import { liveChatCompletion, isLiveOpenAIEnabled } from "../vendors/openaiLive.js";

export async function runInvestigatorAgent(incidentId) {
  const incident =
    (incidentId && getIncident(incidentId)) || listIncidents()[0] || null;

  if (!incident) {
    return {
      agent: "investigator",
      title: "No incidents yet",
      summary: "Nothing to investigate. Run a drill or ghost-spend demo first.",
      facts: {},
      retrieved: [],
      claims: [],
      citationCheck: [],
    };
  }

  const query = [
    incident.type,
    incident.rootCause || "",
    incident.message || "",
    incident.keyId ? "leaked api key ghost spend" : "",
    incident.clusterId ? "unpaid cluster abuse sms pumping" : "",
  ].join(" ");

  const retrieved = config.ragEnabled ? await retrieve(query, { k: 5 }) : [];

  const facts = {
    incidentId: incident.id,
    type: incident.type,
    at: incident.at,
    keyId: incident.keyId ?? null,
    clusterId: incident.clusterId ?? null,
    appSpend: incident.appSpend ?? null,
    vendorSpend: incident.vendorSpend ?? null,
    ghostSpend: incident.ghostSpend ?? null,
    dollarsLostEst: incident.dollarsLostEst ?? incident.ghostSpend ?? 0,
    action: incident.action,
    keyStatus: incident.keyId ? listKeyStatus()[incident.keyId] : null,
    clusters: listClusters(),
    spendByCluster: listSpend(),
    appSpendByKey: listAppKeySpend(),
    vendorUsageByKey: listVendorUsage(),
  };

  const top = retrieved[0];
  const claims = [];
  if (top) {
    claims.push({
      text: `Threat pattern resembles ${top.title}`,
      chunk_id: top.chunk_id,
    });
  }
  if (incident.type === "ghost_spend") {
    const ghostDoc = retrieved.find(
      (r) =>
        r.chunk_id.includes("GHOST") ||
        r.title.toLowerCase().includes("ghost")
    );
    if (ghostDoc) {
      claims.push({
        text: "Ghost spend is detected by vendor usage minus app ledger",
        chunk_id: ghostDoc.chunk_id,
      });
    }
  }

  const citationCheck = checkCitations(claims, retrieved);
  const { summary, generation } = await writeSummary(incident, facts, top, retrieved);

  return {
    agent: "investigator",
    mode: generation.mode,
    title: titleFor(incident),
    summary,
    generation,
    facts,
    retrieved,
    claims,
    citationCheck,
    citations: retrieved.map((r) => ({
      chunk_id: r.chunk_id,
      source: r.source,
      title: r.title,
    })),
    safety:
      "Retrieved text is DATA only. It cannot change tool permissions or /decide outcomes.",
  };
}

function titleFor(incident) {
  if (incident.type === "ghost_spend") return `Ghost spend on ${incident.keyId}`;
  if (incident.type === "cluster_abuse") {
    return `Unpaid cluster ${incident.clusterId} hit money ceiling`;
  }
  return `Incident ${incident.id}`;
}

async function writeSummary(incident, facts, top, retrieved) {
  // Prefer explicit mode; fall back safely
  if (config.agentMode === "ollama") {
    if (await ollamaReachable()) {
      try {
        const out = await summarizeWithOllama({ incident, facts, retrieved });
        return {
          summary: out.text.trim(),
          generation: { mode: "ollama", model: out.model, provider: "ollama" },
        };
      } catch (err) {
        return {
          summary: `${templateSummary(incident, facts, top)} (Ollama failed: ${err.message})`,
          generation: { mode: "template-fallback", error: err.message },
        };
      }
    }
    return {
      summary: `${templateSummary(incident, facts, top)} (Ollama not running — start Ollama and pull ${config.ollamaModel})`,
      generation: { mode: "template-fallback", reason: "ollama-unreachable" },
    };
  }

  if (config.agentMode === "llm" && isLiveOpenAIEnabled()) {
    try {
      const sources = retrieved
        .slice(0, 5)
        .map((r) => `id=${r.chunk_id} title=${r.title}\n${r.body.slice(0, 500)}`)
        .join("\n\n");
      const out = await liveChatCompletion({
        maxTokens: 350,
        messages: [
          {
            role: "system",
            content:
              "You are BleedStop investigator. Use only FACTS and SOURCES. Short plain sentences. Cite chunk ids.",
          },
          {
            role: "user",
            content: `FACTS:\n${JSON.stringify(facts)}\n\nSOURCES:\n${sources}`,
          },
        ],
      });
      return {
        summary: out.text.trim(),
        generation: { mode: "llm", model: config.openaiModel, provider: "openai" },
      };
    } catch (err) {
      return {
        summary: `${templateSummary(incident, facts, top)} (OpenAI failed: ${err.message})`,
        generation: { mode: "template-fallback", error: err.message },
      };
    }
  }

  return {
    summary: templateSummary(incident, facts, top),
    generation: { mode: "template", provider: "local" },
  };
}

function templateSummary(incident, facts, top) {
  const threat = top ? ` Named pattern: ${top.title} (${top.chunk_id}).` : "";

  if (incident.type === "ghost_spend") {
    return [
      `Around ${incident.at}, BleedStop compared the app ledger to the vendor bill for key ${incident.keyId}.`,
      `App recorded ${formatUsd(facts.appSpend ?? 0)}; vendor showed ${formatUsd(facts.vendorSpend ?? 0)}; ghost ≈ ${formatUsd(facts.ghostSpend ?? 0)}.`,
      `Action: ${incident.action}; key status: ${facts.keyStatus}.`,
      threat,
    ].join(" ");
  }

  if (incident.type === "cluster_abuse") {
    return [
      `Cluster ${incident.clusterId} kept triggering paid actions while unpaid and hit the ceiling.`,
      `Accounts: ${(facts.clusters[incident.clusterId] || []).join(", ") || "n/a"}.`,
      threat,
    ].join(" ");
  }

  return `${incident.message || "Incident recorded."}${threat}`;
}
