# OpenAI compatible proxy against a REAL upstream (Groq free tier)

These are **real upstream** measurements, kept separate from the mock results in `results/openai-proxy.json`. Raw output: `results/real-upstream.json`. Run on 2026-10-20T14:31:51.624Z from the build box (Node v20.19.2).

* Upstream: `https://api.groq.com/openai/v1` (Groq free tier; no paid plan, no billing).
* Model: **`openai/gpt-oss-20b`**. The planned `llama-3.1-8b-instant` returned `model_not_found` for this key, and Groq's model list for the key did not include it, so the smallest available chat model was used. It is a reasoning model, so a share of the output tokens is reasoning.
* Script: `benchmark/openai/run-real.js --n 20 --cap 64`. The key is read from the environment of that one process only and is never logged.

## 1. Added latency (non streaming)

Method: 20 pairs, alternating a direct call to Groq and the same call through BleedStop (prompt "Reply with the single word: ok", max_tokens 16, temperature 0), with a 1.2 s pause per pair. Success: 20/20 direct, 20/20 via proxy, 0 errors, no 429 retries needed.

| | p50 | p99 (at n=20, the slowest call) |
|---|---|---|
| Direct to Groq | 245.8 ms | 447.9 ms |
| Through BleedStop | 234.2 ms | 399.2 ms |
| Difference | -11.6 ms | -48.7 ms |

**Reading:** the proxy's added latency **could not be measured over internet noise at this sample size**. The through BleedStop calls were not slower: the difference was negative, which is run to run network variation, not a speedup. The local mock benchmark (1.5 ms p50 added) remains the overhead estimate.

## 2. Token limit on a streaming request

Request: "1500 word essay", `stream: true`, `max_tokens: 4000`. BleedStop's output cap was set to 64 tokens (`OPENAI_PROXY_MAX_OUTPUT_TOKENS=64`).

| | Status | Completion tokens | Total tokens |
|---|---|---|---|
| Direct to Groq (1 call) | 200 | 2618 (of which 440 reasoning) | 2705 |
| Through BleedStop, call 1 | 200 | 64 | 151 |
| Through BleedStop, call 2 | 200 | 64 | 151 |
| Through BleedStop, call 3 | 200 | 64 | 151 |

How the cap took effect: BleedStop rewrote `max_tokens` from 4000 down to its 64 token cap before forwarding, and Groq honoured it. BleedStop's own mid stream cut (`cutByProxy`) was **not needed** here (false on all 3 calls). It exists for upstreams that ignore `max_tokens`, as shown only in the mock flood test. Completion tokens per request fell from 2618 to 64 (97.6% fewer).

## 3. Spend comparison (reconciled cost)

BleedStop reconciles each request to the usage reported by the upstream, priced at the policy rate of $0.01 per 1k tokens (`llmUsdPer1kTokens`). That rate is BleedStop's budgeting rate, not Groq's price. **Actual cost of this run on the Groq free tier: $0.**

| | Tokens | Cost at the policy rate |
|---|---|---|
| Uncapped direct request | 2705 | $0.02705 |
| Capped via BleedStop (reconciled, per request) | 151 | $0.00151 |

Per request, the cap held spend to 5.6% of the uncapped request.

## Caveats

* n=20 for latency, and 1 direct plus 3 proxied requests for the cap test: small on purpose, to stay on the free tier (8,000 tokens per minute limit).
* The model is not the one originally planned (see above).
* The finish reason was not present in the proxied stream's final chunks for this model, so the cap is shown by the usage numbers.
