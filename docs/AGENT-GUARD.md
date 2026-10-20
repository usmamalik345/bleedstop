# Agent guard (AI security pre-check)

Send `agent: { text, toolName, toolArgs, sessionId, depth }` in `/decide` (enforced as rule R-agent-guard, DENY on "block"), or call `POST /agent/precheck` for a verdict without spend. Deterministic, no LLM call, per-tenant mode `agentGuardMode: off | shadow | enforce`.

| Check | What it flags |
|---|---|
| Injection families | override / reset of instructions, restriction removal, system prompt probing, fake chat delimiters, indirect "note to the AI" markers, encoded payload + "then follow" |
| Exfiltration | send/upload/leak to URL or webhook, markdown image beacons with query params, requests to print secrets; secret-shaped strings (OpenAI, AWS, GitHub, Slack, private key) in arguments of network tools |
| Tool abuse | same tool + args 5 times in a session (loop), more than `agentMaxToolCallsPerMin` calls per session |
| Recursive spend | `depth` above `agentMaxDepth` |

## Measured (evals/run-agent-evals.js)
| Set | Detection (block) | FP (block) | FP (flag or block) |
|---|---:|---:|---:|
| Dev set, 55 injection / 57 benign (rules tuned on it) | 96.4% | 0.0% | 1.8% |
| **Held-out set, 40 / 40 (written after tuning, never tuned on)** | **22.5%** | **0.0%** | 2.5% |
| Tool-call sequences, 7 abusive / 5 benign | 100% | 0% | |

The optional lexical classifier (`useClassifier`) changed nothing on either set. **Quote the held-out number.** The guard is reliable for the cost side (loops, velocity, recursion, secret exfiltration through tools) and weak as a general injection detector: paraphrases, other languages, string reversal and soft social engineering get through. Use it as one layer next to least-privilege tools and human confirmation for destructive actions; a learned classifier evaluated on the held-out split is the next step.

## Pattern sources (all examples are paraphrased, not copied datasets)
* OWASP Top 10 for LLM Applications 2025: LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure, LLM06 Excessive Agency, LLM07 System Prompt Leakage, LLM10 Unbounded Consumption. https://genai.owasp.org/llm-top-10/
* F. Perez, I. Ribeiro, "Ignore Previous Prompt: Attack Techniques for Language Models", 2022, arXiv:2211.09527 (goal hijacking, prompt leaking).
* K. Greshake et al., "Not what you've signed up for: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection", 2023, arXiv:2302.12173 (instructions hidden in retrieved content).
* X. Shen et al., "Do Anything Now: Characterizing and Evaluating In-The-Wild Jailbreak Prompts on Large Language Models", 2023, arXiv:2308.03825 (DAN / role jailbreaks).
* S. Willison, prompt injection series, https://simonwillison.net/series/prompt-injection/ (markdown image exfiltration, delimiter tricks).
* J. Rehberger, Embrace The Red, https://embracethered.com/blog/ (data exfiltration via rendered images and tool calls).
* MITRE ATLAS AML.T0051 LLM Prompt Injection, https://atlas.mitre.org/
