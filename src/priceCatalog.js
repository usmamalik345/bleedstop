/**
 * Price catalog = menu of action costs (demo prices).
 * Real product: load versioned prices from OpenAI/Twilio/etc.
 */

export const prices = {
  "sms.send": { usd: 0.08, vendor: "twilio" },
  "llm.call": { usd: 0.015, vendor: "openai" },
  "llm.call.small": { usd: 0.003, vendor: "openai" },
  "email.send": { usd: 0.001, vendor: "resend" },
  "payment.attempt": { usd: 5, vendor: "stripe" },
  "signup.create": { usd: 0, vendor: "app" },
  "auth.login": { usd: 0, vendor: "app" },
};

export function getPrice(action) {
  const row = prices[action];
  if (!row) {
    throw new Error(`Unknown action: ${action}. Add it to the price catalog.`);
  }
  return row.usd;
}

export function getPriceInfo(action) {
  const row = prices[action];
  if (!row) {
    throw new Error(`Unknown action: ${action}.`);
  }
  return { action, ...row };
}

export function listPrices() {
  return { ...prices };
}
