# Injection classifier benchmark (local, CPU)

Model `protectai/deberta-v3-base-prompt-injection-v2`, torch 2.14.1+cpu, 4 CPU threads, run 2026-10-20T10:00:19Z. Regex = BleedStop agent guard `block` verdict. Two stage = regex block OR classifier score >= 0.5.

| Set | n | Detector | Precision | Recall | FPR | Latency p50 / p99 |
|---|---|---|---|---|---|---|
| deepset/prompt-injections (all 662) | 662 | regex | 100.0% | 4.2% | 0.0% | 7.864 / 152.048 us |
| | | classifier | 96.5% | 41.4% | 1.0% | 48.09 / 131.713 ms |
| | | two stage | 96.5% | 41.4% | 1.0% | |
| deepset/prompt-injections (test split 116) | 116 | regex | 100.0% | 1.7% | 0.0% | 11.004 / 1677.285 us |
| | | classifier | 100.0% | 36.7% | 0.0% | 48.628 / 100.483 ms |
| | | two stage | 100.0% | 36.7% | 0.0% | |
| BleedStop dev set (regex tuned on it) | 112 | regex | 100.0% | 96.4% | 0.0% | 9.14 / 1591.156 us |
| | | classifier | 92.0% | 83.6% | 7.0% | 45.955 / 55.402 ms |
| | | two stage | 93.0% | 96.4% | 7.0% | |
| BleedStop held-out set | 80 | regex | 100.0% | 22.5% | 0.0% | 9.961 / 3663.363 us |
| | | classifier | 93.9% | 77.5% | 5.0% | 45.075 / 58.774 ms |
| | | two stage | 94.1% | 80.0% | 5.0% | |
| PINT example file (8 rows, NOT the PINT benchmark) | 8 | regex | 100.0% | 50.0% | 0.0% | 141.794 / 2959.131 us |
| | | classifier | 100.0% | 100.0% | 0.0% | 65.803 / 454.006 ms |
| | | two stage | 100.0% | 100.0% | 0.0% | |

## Caveats

* deepset/prompt-injections contains German and other non English rows; the v2 model is documented as English only, which lowers its recall there.
* The protectai v2 model card lists its training sources; overlap with public sets like deepset cannot be ruled out, so treat deepset numbers as optimistic for the classifier.
* The PINT row uses the public 8 row example file shipped in the PINT repo. It is not the gated PINT benchmark and is not a PINT score.
* Llama Prompt Guard 2 is gated on Hugging Face and was not evaluated.
* The regex was tuned on the BleedStop dev set; the held-out set was written after tuning.
