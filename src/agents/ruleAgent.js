/**
 * Rule agent (OFF hot path).
 * Proposes rules from RAG playbooks + backtests them. Never auto-enforces.
 */

import { retrieve } from "../rag/retrieve.js";
import { addProposal } from "../rules/store.js";
import { backtestRule } from "../rules/backtester.js";
import { listIncidents } from "../incidents.js";

export async function runRuleAgent(incidentId) {
  const incident =
    listIncidents().find((i) => i.id === incidentId) || listIncidents()[0];

  if (!incident) {
    return { agent: "rule", proposals: [], note: "No incident to learn from." };
  }

  const retrieved = await retrieve(
    `${incident.type} countermeasure playbook rule SMS OTP leaked key`,
    { k: 4 }
  );

  const proposals = [];

  if (incident.type === "ghost_spend") {
    const rule = {
      id: "R-key-wrapper",
      name: "force-server-side-keys",
      type: "wiring",
      description:
        "Move AI calls behind a server/edge function; never ship unrestricted browser keys.",
      enabled: true,
    };
    proposals.push(
      addProposal({
        title: "Require server-side vendor keys",
        reason: "Ghost spend usually means a key was reachable outside the app path.",
        rule,
        evidence: retrieved.slice(0, 2),
        backtest: {
          note: "Wiring rule — validate with repo scan / PR, not traffic replay.",
          recommendation: "Approve wiring PR after CI passes on victim apps.",
        },
      })
    );
  }

  const otpRule = {
    id: "R-otp-country",
    name: "otp-country-mismatch",
    type: "otp_country_mismatch",
    description:
      "Block OTP when phone country differs from IP country for unpaid accounts.",
    enabled: true,
  };
  const backtest = backtestRule(otpRule);
  proposals.push(
    addProposal({
      title: "Enforce OTP country mismatch rule",
      reason: "Common bot-farm signal on signup/SMS pumping.",
      rule: otpRule,
      evidence: retrieved.filter((r) =>
        /sms|otp|account creation|pump/i.test(`${r.title} ${r.body}`)
      ),
      backtest,
    })
  );

  return {
    agent: "rule",
    incidentId: incident.id,
    retrieved,
    proposals,
    note: "Human must approve. Agent cannot flip mode to enforce by itself.",
  };
}
