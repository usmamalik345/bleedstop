# ADR-0001: Deterministic rules on the hot path
**Context.** /decide sits in front of every paid call; it must be fast, explainable and not manipulable by the content it judges.
**Decision.** Only the rule engine (`src/rules/engine.js`) can return ALLOW/LIMIT/CHALLENGE/DENY. LLM agents (investigator, rule proposals) run off path and can only *propose* rules, which start in shadow mode.
**Consequences.** Sub-millisecond rule evaluation; same input gives the same answer; prompt injection cannot flip a decision. Detection is limited to what rules express (see evals for misses).
