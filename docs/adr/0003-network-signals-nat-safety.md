# ADR-0003: IP and ASN are pool/velocity signals, never identity unions
**Context.** Rotating farms change device and email per account, so ADR-0002 alone gives each one a fresh budget (0% blocked). The legacy code unioned identities on ASN, which merges every customer of an ISP: on the golden set that caused 43.7% FP for 60 legit users of one ISP and 66.2% for a 200-user campus.
**Decision.**
1. IP and ASN never union identities (`CLUSTER_ON_ASN=1` restores legacy, for comparison only).
2. Subnet pool: once a /24 (IPv6 /64) has >= `subnetPoolMinActors` unpaid actors in a 10 min window, they share a pool ceiling `max(subnetPoolCeilingUsd, subnetPoolPerActorUsd x actors)`. The per-actor term exists because a fixed $5 pool denied 66.7% of a 200-user /24 in the attack suite.
3. ASN spread (unpaid actors from one ASN across > N /24s) yields CHALLENGE, default **shadow**: enforcing it caught 80% of a residential-proxy farm but also flagged 66.7% of legit ISP users.
4. `SUBNET_ALLOWLIST` / `ASN_ALLOWLIST` skip both.
**Consequences.** Golden set default config: 0.0% FP across all 5 benign scenarios, rotated same-subnet farm recall 66.7% (was 0% without ASN union). Residential proxies spread over an ISP and fully rotated farms remain open (0%). Network state is per process.
