# Evals

## Traffic golden set (`evals/golden/traffic-v1.jsonl`)
12,140 labeled `/decide` requests generated deterministically by `evals/generate-golden.js` (versioned; CI evaluates the committed file and prints its sha256).

| Scenario | Label | Requests | Shape |
|---|---|---:|---|
| normal_users | benign | 1,000 | 200 users x 5, own device/email/IP |
| shared_household_device | benign | 40 | 4 people, one laptop, one IP |
| office_nat_same_ip | benign | 300 | 60 employees, one public IP |
| campus_nat_one_subnet | benign | 1,000 | 200 students in one /24 (added after the attack suite exposed a fixed-pool FP) |
| isp_many_new_users | benign | 600 | 60 customers of one ASN across 60 /24s, 10 calls each |
| farm_shared_device | abusive | 2,000 | 100 accounts, one device |
| token_flood | abusive | 200 | 400k char prompts |
| retry_storm | abusive | 1,000 | one actor looping |
| rotated_same_subnet | abusive | 2,000 | 100 accounts, all signals rotated, one /24 |
| rotated_residential_proxy_one_asn | abusive | 2,000 | 100 accounts, 100 /24s, one ASN |
| rotated_fully | abusive | 2,000 | 100 accounts, distinct /24s and ASNs |

Positive = DENY or CHALLENGE. Every request in an abusive scenario is labeled abusive, so the free budget a farm legitimately gets before the ceiling counts against recall (strict). Run: `node evals/run-evals.js --gate`. CI gate: 0% FP on every benign scenario, overall precision >= 99%, recall >= 99% token flood, >= 90% farm and retry storm, >= 40% rotated same subnet.

Results: `results/EVAL-REPORT.md` (original code, legacy ASN union, current default, ASN spread enforce).

## Agent guard sets (`evals/agent/`)
* `injection-v1.jsonl` dev set (rules tuned on it), `injection-test-v1.jsonl` held-out, `tool-sequences-v1.jsonl`. See AGENT-GUARD.md.

## Honesty rules
* The golden set and the rules are written by the same author: treat numbers as regression baselines, not field accuracy.
* One scenario (campus NAT) was added after a failure was seen; that is recorded above.
* The held-out injection set was written after tuning and must not be tuned on; add v2 sets for new rules.
