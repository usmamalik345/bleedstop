---
title: BleedStop Injection Classifier
emoji: 🛡️
colorFrom: gray
colorTo: red
sdk: docker
app_port: 7860
pinned: false
license: apache-2.0
---

Second stage prompt injection classifier for [BleedStop](https://github.com/usmamalik345/bleedstop).
Model: `protectai/deberta-v3-base-prompt-injection-v2` (Apache 2.0, English only), CPU.

* `GET /health`
* `POST /classify` with `{"text": "..."}` returns `{"label", "score", "ms", "model"}`

Deploy: create a Docker Space (CPU basic, free), push these four files to it, then set on Vercel
`CLASSIFIER_URL=https://<user>-<space>.hf.space` and `CLASSIFIER_TIMEOUT_MS=1500`.
A free Space sleeps when idle; while it wakes up, requests time out and BleedStop falls back to the regex verdict.
