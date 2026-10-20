/**
 * Backtester = replay old events against a proposed rule.
 * Shows: how many attacks stopped vs real users hurt (false positives).
 */

import { allEvents } from "../eventLog.js";
import { config } from "../config.js";

/**
 * Very small DSL for demos:
 * { type: "otp_country_mismatch" }
 * { type: "unpaid_ceiling", ceiling: 5 }
 */
export function backtestRule(rule, { days = 30 } = {}) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const events = allEvents().filter((e) => new Date(e.at).getTime() >= since);

  let wouldDeny = 0;
  let wouldLimit = 0;
  let falsePositives = 0; // paid users that would be denied
  let truePositives = 0; // unpaid that would be denied/limited
  let dollarsSaved = 0;

  for (const e of events) {
    if (e.type !== "decision") continue;
    const hit = simulate(rule, e);
    if (!hit) continue;

    if (hit === "DENY") {
      wouldDeny += 1;
      dollarsSaved += e.estimatedCost ?? 0;
    }
    if (hit === "LIMIT") wouldLimit += 1;

    if (e.paid) falsePositives += 1;
    else truePositives += 1;
  }

  const totalHits = wouldDeny + wouldLimit;
  return {
    rule,
    days,
    eventsScanned: events.filter((e) => e.type === "decision").length,
    wouldDeny,
    wouldLimit,
    truePositives,
    falsePositives,
    falsePositiveRate:
      totalHits === 0 ? 0 : Number((falsePositives / totalHits).toFixed(4)),
    dollarsSavedEst: Number(dollarsSaved.toFixed(3)),
    recommendation:
      totalHits === 0
        ? "No historical hits — keep in shadow longer or gather more traffic."
        : falsePositives / Math.max(totalHits, 1) > 0.05
          ? "High false positives — tune before enforce."
          : "Looks safe to move from shadow → enforce after 24h.",
  };
}

function simulate(rule, event) {
  if (rule.type === "unpaid_ceiling" && !event.paid) {
    const ceiling = rule.ceiling ?? config.unpaidCeilingUsd;
    // Approximate: if spendAfter already near ceiling, count as hit
    if ((event.spendAfter ?? 0) >= ceiling * 0.9) return "DENY";
  }
  if (
    rule.type === "otp_country_mismatch" &&
    event.action === "sms.send" &&
    !event.paid &&
    event.phoneCountry &&
    event.ipCountry &&
    event.phoneCountry !== event.ipCountry
  ) {
    return "DENY";
  }
  if (
    rule.type === "llm_soft_limit" &&
    event.action === "llm.call" &&
    !event.paid
  ) {
    return "LIMIT";
  }
  return null;
}
