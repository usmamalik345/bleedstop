/**
 * Compatibility facade — morning report + agent-backed investigate.
 */

import { runInvestigatorAgent } from "./agents/investigatorAgent.js";
import { runRuleAgent } from "./agents/ruleAgent.js";
import { listIncidents } from "./incidents.js";

export async function investigate(incidentId) {
  const report = await runInvestigatorAgent(incidentId);
  const rules = await runRuleAgent(incidentId || report.facts?.incidentId);
  return {
    ...report,
    suggestedRules: rules.proposals || [],
    ruleAgent: {
      note: rules.note,
      retrieved: rules.retrieved,
    },
  };
}

export function morningReport() {
  const incidents = listIncidents().slice(0, 10);
  if (incidents.length === 0) {
    return {
      headline: "Quiet night",
      body: "No abuse or ghost-spend incidents. Ledgers look calm.",
      incidents: [],
    };
  }

  const lost = incidents.reduce(
    (sum, i) => sum + (i.dollarsLostEst || i.ghostSpend || 0),
    0
  );
  return {
    headline: `${incidents.length} incident(s), ~$${lost.toFixed(2)} contained`,
    body: incidents.map((i) => `• ${i.type}: ${i.message || i.id}`).join("\n"),
    incidents,
  };
}
