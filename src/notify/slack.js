/**
 * Slack Incoming Webhook notifier (optional).
 * Set SLACK_WEBHOOK_URL in .env — empty = silent (tests / local).
 */

import { config } from "../config.js";

export function slackEnabled() {
  return Boolean(config.slackWebhookUrl?.startsWith("https://"));
}

/**
 * Fire-and-forget friendly: never throws to callers.
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: string }>}
 */
export async function notifySlack(text, { blocks } = {}) {
  if (!slackEnabled()) return { ok: true, skipped: true };

  try {
    const body = { text };
    if (blocks) body.blocks = blocks;

    const res = await fetch(config.slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`Slack notify failed: HTTP ${res.status} ${detail}`);
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.warn("Slack notify error:", err.message);
    return { ok: false, error: err.message };
  }
}

/** Ghost-spend kill-switch alert template */
export function ghostSpendSlackText({
  keyId,
  ghostSpend,
  appSpend,
  vendorSpend,
  tenantId,
  incidentId,
}) {
  return [
    `🚨 *BleedStop ghost spend*`,
    `• Tenant: \`${tenantId || "unknown"}\``,
    `• Key: \`${keyId}\` → *disabled*`,
    `• Ghost gap: *$${Number(ghostSpend).toFixed(2)}* (vendor $${Number(vendorSpend).toFixed(2)} − app $${Number(appSpend).toFixed(2)})`,
    incidentId ? `• Incident: \`${incidentId}\`` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
