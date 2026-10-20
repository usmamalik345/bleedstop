import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseApiKeyMap,
  resolveApiKey,
  apiKeysEnabled,
} from "../src/auth/apiKeys.js";
import { runWithTenant, getTenantId } from "../src/tenant/context.js";
import { ghostSpendSlackText, slackEnabled } from "../src/notify/slack.js";
import { config } from "../src/config.js";

test("parseApiKeyMap reads key:tenant pairs", () => {
  const map = parseApiKeyMap("demo:local-dev, acme:tenant-acme");
  assert.equal(map.get("demo"), "local-dev");
  assert.equal(map.get("acme"), "tenant-acme");
  assert.equal(map.size, 2);
});

test("resolveApiKey returns tenant or null", () => {
  // Uses process env map — empty in tests by default
  const prev = config.apiKeysRaw;
  config.apiKeysRaw = "k1:t1";
  assert.equal(resolveApiKey("k1"), "t1");
  assert.equal(resolveApiKey("bad"), null);
  config.apiKeysRaw = prev;
});

test("runWithTenant scopes getTenantId", () => {
  const outside = getTenantId();
  runWithTenant("tenant-x", () => {
    assert.equal(getTenantId(), "tenant-x");
  });
  assert.equal(getTenantId(), outside);
});

test("ghostSpendSlackText includes key and dollars", () => {
  const text = ghostSpendSlackText({
    keyId: "gm-demo-key",
    ghostSpend: 55,
    appSpend: 0,
    vendorSpend: 55,
    tenantId: "local-dev",
    incidentId: "inc-1",
  });
  assert.match(text, /gm-demo-key/);
  assert.match(text, /\$55/);
  assert.match(text, /local-dev/);
});

test("slackEnabled is false without URL", () => {
  const prev = config.slackWebhookUrl;
  config.slackWebhookUrl = "";
  assert.equal(slackEnabled(), false);
  config.slackWebhookUrl = prev;
});

test("apiKeysEnabled false when map empty", () => {
  const prev = config.apiKeysRaw;
  config.apiKeysRaw = "";
  assert.equal(apiKeysEnabled(), false);
  config.apiKeysRaw = prev;
});
