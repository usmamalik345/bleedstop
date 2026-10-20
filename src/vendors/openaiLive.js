/**
 * Optional LIVE OpenAI usage pull.
 * Portfolio / production path: set OPENAI_API_KEY (and ideally a separate restricted key).
 *
 * Honesty:
 * - Without keys → local ledger only (still a real control plane).
 * - With keys → records real token cost after each call + can refresh vendor total.
 */

import { config } from "../config.js";
import { recordVendorUsage, getVendorUsage } from "../vendorMock.js";
import { roundMoney } from "../utils/money.js";

/** Rough public prices for portfolio math (update when you pin a model). */
const PRICE = {
  "gpt-4o-mini": { in: 0.15 / 1e6, out: 0.6 / 1e6 },
  "gpt-4o": { in: 2.5 / 1e6, out: 10 / 1e6 },
  default: { in: 0.15 / 1e6, out: 0.6 / 1e6 },
};

export function isLiveOpenAIEnabled() {
  return Boolean(config.openaiApiKey);
}

export function estimateChatCostUsd({ model, promptTokens, completionTokens }) {
  const p = PRICE[model] || PRICE.default;
  return roundMoney(
    promptTokens * p.in + completionTokens * p.out
  );
}

/**
 * Call OpenAI Chat Completions for real (when key exists).
 * Returns { text, usage, costUsd }.
 */
export async function liveChatCompletion({
  model = config.openaiModel || "gpt-4o-mini",
  messages,
  maxTokens = 300,
}) {
  if (!config.openaiApiKey) {
    throw new Error(
      "OPENAI_API_KEY missing. Add it to .env for live mode, or use offline mode."
    );
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `OpenAI HTTP ${res.status}`);
  }

  const usage = data.usage || {};
  const costUsd = estimateChatCostUsd({
    model,
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
  });

  return {
    text: data.choices?.[0]?.message?.content || "",
    usage,
    costUsd,
    model,
    raw: data,
  };
}

/**
 * Push observed vendor cost into BleedStop ledger (for ghost detection baseline).
 * keyId should be a logical key name you protect (e.g. "oa-live-key").
 */
export function publishLiveVendorCost(keyId, costUsd) {
  return recordVendorUsage(keyId, costUsd);
}

export function readPublishedVendorCost(keyId) {
  return getVendorUsage(keyId);
}
