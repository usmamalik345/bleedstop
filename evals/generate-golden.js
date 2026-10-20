/**
 * Generates the versioned golden set evals/golden/traffic-v1.jsonl (deterministic, no randomness).
 * One line = one /decide request with a ground-truth label.
 * Re-run only when bumping the version; CI evaluates the committed file.
 */
import fs from "node:fs";

const VERSION = "v1";
const rows = [];
const P = (chars, max = 512) => Math.ceil(chars / 4) + max; // estimatedTokens = prompt tokens + max output
let seq = 0;
function add(scenario, label, body) { rows.push({ id: `${VERSION}-${String(++seq).padStart(5, "0")}`, scenario, label, request: { action: "llm.call", paid: false, ...body } }); }

// Benign
for (let u = 0; u < 200; u++) for (let k = 0; k < 5; k++)
  add("normal_users", "benign", { actorId: `user-${u}`, estimatedTokens: P(2000), signals: { deviceFingerprint: `fp-user-${u}`, email: `person${u}@company${u % 37}.com`, ip: `10.${u % 200}.${(u * 7) % 250}.${u % 250}`, asn: `AS${64600 + (u % 40)}` } });
for (let u = 0; u < 4; u++) for (let k = 0; k < 10; k++)
  add("shared_household_device", "benign", { actorId: `home-${u}`, estimatedTokens: P(2000), signals: { deviceFingerprint: "fp-family-laptop", email: `member${u}@family.example`, ip: "192.0.2.44", asn: "AS64501" } });
for (let u = 0; u < 60; u++) for (let k = 0; k < 5; k++)
  add("office_nat_same_ip", "benign", { actorId: `office-${u}`, estimatedTokens: P(2000), signals: { deviceFingerprint: `fp-office-${u}`, email: `emp${u}@corp.example`, ip: "198.18.0.10", asn: "AS64502" } });
// Added after the attack suite showed a fixed $5 subnet pool blocking a 200-user /24 (see docs/EVALS.md)
for (let u = 0; u < 200; u++) for (let k = 0; k < 5; k++)
  add("campus_nat_one_subnet", "benign", { actorId: `campus-${u}`, estimatedTokens: P(2000), signals: { deviceFingerprint: `fp-campus-${u}`, email: `student${u}@uni.example`, ip: `10.1.0.${u + 1}`, asn: "AS64504" } });
for (let u = 0; u < 60; u++) for (let k = 0; k < 10; k++)
  add("isp_many_new_users", "benign", { actorId: `isp-${u}`, estimatedTokens: P(2000), signals: { deviceFingerprint: `fp-isp-${u}`, email: `cust${u}@isp-mail.example`, ip: `100.${64 + (u % 60)}.${u}.20`, asn: "AS64503" } });

// Abusive
for (let a = 0; a < 100; a++) for (let k = 0; k < 20; k++)
  add("farm_shared_device", "abusive", { actorId: `farm-${a}`, estimatedTokens: P(2000), signals: { deviceFingerprint: "fp-farm-shared", email: `bot${a}@mailbox${a}.net`, ip: `203.0.${a % 250}.${a}`, asn: `AS${65000 + a}` } });
for (let k = 0; k < 200; k++)
  add("token_flood", "abusive", { actorId: "flooder", estimatedTokens: P(400_000, 4096), signals: { deviceFingerprint: "fp-flood", email: "flooder@x.example", ip: "192.0.2.9" } });
for (let k = 0; k < 1000; k++)
  add("retry_storm", "abusive", { actorId: "looper", estimatedTokens: P(2000), signals: { deviceFingerprint: "fp-loop", email: "looper@x.example", ip: "192.0.2.10" } });
for (let a = 0; a < 100; a++) for (let k = 0; k < 20; k++)
  add("rotated_same_subnet", "abusive", { actorId: `rot-${a}`, estimatedTokens: P(2000), signals: { deviceFingerprint: `fp-rot-${a}`, email: `rot${a}@m${a}.net`, ip: `198.51.100.${a + 1}`, asn: "AS64510" } });
for (let a = 0; a < 100; a++) for (let k = 0; k < 20; k++)
  add("rotated_residential_proxy_one_asn", "abusive", { actorId: `rp-${a}`, estimatedTokens: P(2000), signals: { deviceFingerprint: `fp-rp-${a}`, email: `rp${a}@m${a}.org`, ip: `172.${16 + (a % 16)}.${a}.7`, asn: "AS64520" } });
for (let a = 0; a < 100; a++) for (let k = 0; k < 20; k++)
  add("rotated_fully", "abusive", { actorId: `rf-${a}`, estimatedTokens: P(2000), signals: { deviceFingerprint: `fp-rf-${a}`, email: `rf${a}@m${a}.io`, ip: `${11 + (a % 100)}.${a}.${a}.9`, asn: `AS${66000 + a}` } });

fs.writeFileSync(new URL(`./golden/traffic-${VERSION}.jsonl`, import.meta.url), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`wrote ${rows.length} rows (${VERSION})`);
