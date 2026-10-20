# BleedStop threat model (OWASP LLM10 Unbounded Consumption / denial of wallet)

## Assets
* Provider budget (LLM tokens, SMS, payment fees) billed to the app owner.
* Vendor API keys (OpenAI, Twilio, Stripe).
* Free tier quota meant for real users.

## Trust boundaries
1. Internet client → your app (untrusted input: actorId, email, device fingerprint, prompt).
2. Your app → BleedStop `/decide` (trusted server to server call; optional `X-API-Key` per tenant).
3. Your app → vendor (the money leaves here; BleedStop only sees it if the app asks first or via reconcile).
4. Vendor usage → BleedStop reconciler (ghost spend detection).

## Threats and controls

| Threat | Example | Control in BleedStop | Rule / module |
|---|---|---|---|
| Free tier farming | 100 accounts, one device | Union-Find identity clustering on device fingerprint, normalised email, ASN; one $ ceiling per cluster | `src/cluster.js`, R-ceiling |
| Token flooding | 400k char prompts on a free account | Token-aware cost (`estimatedTokens`) and per request token cap for unpaid callers | R-llm-max-tokens, `estimateCost()` |
| Retry / agent loop storms | 1,000 calls in seconds | Per cluster LLM velocity (60 / rolling 60s by default); idempotency key dedupe in SDK and server | R-llm-velocity, `src/idempotency.js`, `sdk/client.js` |
| Rotating identities in one network | 100 accounts, new device/email each, one /24 | Subnet pool ceiling that scales with distinct actors (no identity union on IP) | R-subnet-pool, `src/network.js` |
| Residential proxy farm in one ASN | accounts across many /24s of one ISP | ASN spread CHALLENGE (default shadow: also flags legit ISP growth) | R-asn-spread |
| Prompt injection / tool abuse in agents | "ignore previous instructions", secrets sent via http tool, tool loops, agent recursion | Deterministic agent guard | R-agent-guard, `src/agentGuard.js` |
| Attacks on the control plane | flooding /decide, oversized or malformed bodies, cross-tenant reads | Rate limit, strict validation, body limit, API keys (hashed), STRICT_READS, RBAC + audit | ADR-0007 |
| Multi-instance overspend | 2+ pods charging the last dollar | Redis Lua check-and-charge, shared identity graph | ADR-0004 |
| Parallel race past the ceiling | 50 concurrent calls with $1 left | Per cluster lock re-checks ceiling before charging | `src/locks.js` |
| SMS pumping | OTP to premium numbers | SMS velocity, unpaid ceiling, OTP freeze runbook, country mismatch (shadow) | R-sms-velocity, R-otp-country |
| Leaked key used outside the app | Key on GitHub | Reconcile app ledger vs vendor usage; kill switch disables key | `src/reconciler.js` |
| BleedStop outage | control plane down | Per action fail policy (SMS/payments closed, LLM local cap, login open) | `src/failPolicy.js` |
| Prompt injection into the AI investigator | malicious incident text | Agents never sit on the decide path; retrieved text wrapped as data | `src/agents/*` |

## What it does NOT stop (measured or by design)
* **Fully rotating identities across networks.** New device, email, /24 and ASN per account: golden set recall 0%. Residential proxies inside one ISP: 0% in default (shadow) mode, 80% with ASN spread enforced at the price of 66.7% FP on legit ISP growth. Mitigations not built: tenant-wide free-tier budget, proof of work / CAPTCHA before LLM spend.
* **General prompt injection.** Agent guard held-out detection is 22.5% (dev 96.4%); see AGENT-GUARD.md.
* **Per-process state.** Subnet/ASN windows, agent sessions and the /decide rate limiter are per instance.
* **Apps that do not call `/decide`**, or that send a fake small `estimatedTokens`. Token pricing trusts the caller's estimate; the app must compute it server side from the real prompt.
* **Spend after the decision.** In `auto` mode the estimate is charged; real usage above it is only caught by reconcile (or by `reserve`/`commit` with `actualCost`).
* **Paid accounts** are not subject to the token cap or velocity rule; only the higher paid ceiling.
* **Multi pod correctness without Redis.** In memory velocity windows and locks are per process.
* Content safety, jailbreaks, data exfiltration (other OWASP LLM risks).
