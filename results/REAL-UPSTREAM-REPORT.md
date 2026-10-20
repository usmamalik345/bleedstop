# OpenAI compatible proxy against a REAL upstream

Status: **NOT RUN YET.** No free tier provider key was available on the build machine, so there are no real upstream numbers. This file will hold them once the benchmark is run. All proxy numbers published so far (`results/openai-proxy.json`, README) are against the deterministic **mock** upstream and are kept separate from this report.

## What is needed

A free Groq API key (https://console.groq.com/keys). Alternatively an OpenRouter key works with a `:free` model.

## Method (benchmark/openai/run-real.js)

* Upstream: `https://api.groq.com/openai/v1`, model `llama-3.1-8b-instant` (defaults; override with `REAL_UPSTREAM_URL`, `REAL_UPSTREAM_KEY`, `REAL_UPSTREAM_MODEL`).
* Added latency: N=20 non streaming calls (prompt "Reply with the single word: ok", max_tokens 16, temperature 0), alternating direct and through BleedStop, with a 1.2 s pause per pair to stay under free tier rate limits. Reports direct and proxied p50 and p99 and the p50 difference. At n=20, p99 is effectively the slowest call.
* Token limit: 1 direct streaming request for a 1500 word essay with max_tokens 4000 (upstream reported usage), then 3 of the same request through BleedStop with the output cap set to 64 tokens. Reports finish reason, usage, whether BleedStop itself cut the stream (as opposed to the upstream honouring the lowered max_tokens), and reconciled cost.
* Total size: about 44 small requests, roughly 6k to 8k tokens, inside the Groq free tier.

## Run

```
GROQ_API_KEY=... node benchmark/openai/run-real.js --n 20 --cap 64 --out results/real-upstream.json
```

The key is read from the environment only and never printed or written to the output.

## Results

Pending.
