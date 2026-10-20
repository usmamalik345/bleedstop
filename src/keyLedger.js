import { roundMoney } from "./utils/money.js";
import { dbEnabled } from "./db/postgres.js";
import { upsertAppKeySpend } from "./db/repository.js";
import { enqueuePersist } from "./db/persistQueue.js";

/** @type {Record<string, number>} */
const appSpendByKey = {};

export function addAppKeySpend(keyId, dollars) {
  appSpendByKey[keyId] = roundMoney((appSpendByKey[keyId] ?? 0) + dollars);
  if (dbEnabled()) {
    enqueuePersist("app_key_spend", () =>
      upsertAppKeySpend(keyId, appSpendByKey[keyId])
    );
  }
  return appSpendByKey[keyId];
}

export function getAppKeySpend(keyId) {
  return appSpendByKey[keyId] ?? 0;
}

export function listAppKeySpend() {
  return { ...appSpendByKey };
}

export function resetKeyLedger() {
  for (const key of Object.keys(appSpendByKey)) delete appSpendByKey[key];
}

export function hydrateKeyLedger(map = {}) {
  resetKeyLedger();
  Object.assign(appSpendByKey, map);
}
