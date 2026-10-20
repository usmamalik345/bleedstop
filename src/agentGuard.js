/**
 * Agent call pre-check (AI security layer). Deterministic: same input → same verdict.
 *
 * Checks, in order:
 *  1. Prompt injection heuristics (weighted regex families, OWASP LLM01 patterns)
 *  2. Exfiltration patterns (secrets in output channels, markdown image beacons, "send to URL")
 *  3. Tool abuse: tool-call loops (same tool+args repeated), tool-call velocity per agent session
 *  4. Recursive agent spend: agent spawning agents beyond maxDepth
 *  5. Optional tiny classifier: deterministic logistic score over hashed character n-grams
 *     (weights shipped in code, trained offline is NOT claimed; it is a hand-tuned lexical scorer)
 *
 * Output: { verdict: "allow"|"flag"|"block", score, reasons[] }. Never calls an LLM.
 */
import crypto from "node:crypto";

const FAMILIES = [
  // [id, weight, regex]  strong families weigh 0.6 (= block on their own); weak 0.3 (flag)
  ["override_instructions", 0.6, /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|system|developer|the user)\b[^.\n]{0,25}\b(instruction|prompt|rule|message|direction|guideline|user)s?\b/i],
  ["instruction_reset", 0.6, /\b(set aside everything you were told|no longer applies|(rules|instructions) you were given are (outdated|obsolete|void)|as though no instructions|follow my new rules|respond only to me|forget (everything|all) (you|that) (were|was) told)\b/i],
  ["restriction_removal", 0.6, /\b(no|without|drop|disable[sd]?|remove|ignores?)\b[^.\n]{0,25}\b(content policy|restrictions|filters|safety (rules|constraints|guidelines)|guardrails)\b/i],
  ["new_role", 0.3, /\b(you are now|from now on,? you|pretend (to be|you are)|roleplay as|developer mode (enabled|output)|enable developer mode|\bDAN\b,? which stands|do anything now|jailbreak)/i],
  ["system_prompt_probe", 0.6, /\b(reveal|print|show|repeat|output|leak|tell me|translate)\b[^.\n]{0,40}\b(system prompt|hidden prompt|initial instructions|your instructions|developer message|the prompt above|text above|confidential (instructions|parts)|your configuration)\b|\b(what were|what are) your (initial |original )?instructions\b|\bconfidential instructions\b/i],
  ["fake_delimiter", 0.6, /(<\/?(system|im_start|im_end)>|\[\/?INST\]|###\s*(system|instruction)\s*:|<\|im_(start|end)\|>|BEGIN SYSTEM PROMPT)/i],
  ["tool_hijack", 0.6, /\b(call|invoke|use|run|execute)\b[^.\n]{0,25}\b(tool|function|plugin|shell|bash|terminal)\b[^.\n]{0,60}\b(without (asking|confirmation|telling)|don'?t tell|do not tell|silently|secretly|immediately)\b|\b(silently|secretly)\b[^.\n]{0,40}\b(send|charge|run|execute|delete)\b/i],
  ["exfil_url", 0.6, /\b(send|post|upload|exfiltrate|forward|transmit|leak)\b[^\n]{0,80}(https?:\/\/|webhook|pastebin|ngrok|requestbin)/i],
  ["markdown_beacon", 0.6, /!\[[^\]]*\]\(https?:\/\/[^)\s]*\?[^)\s]*=[^)\s]*(\{|%7B|secret|token|key|data|conversation)/i],
  ["secret_request", 0.6, /\b(print|send|include|reveal|share|output|leak)\b[^.\n?]{0,40}\b(api[_ -]?key|secret[_ -]?key|access[_ -]?token|password|private key|ssh key|\.env|credentials?)\b/i],
  ["encoded_payload", 0.6, /\b(base64|rot13|hex)\b[^\n]{0,50}\bdecode\b[^\n]{0,40}\b(follow|execute|run|obey)\b|\bdecode\b[^\n]{0,40}\b(and|then)\b[^\n]{0,20}\b(follow|execute|obey)\b[^\n]{0,30}\b(instruction|it|command)/i],
  ["indirect_injection_marker", 0.6, /\b(AI|assistant|LLM|model|agent)s?\b[^.\n]{0,30}\b(reading|processing|summari[sz]ing) this\b|\bnote to (the )?(AI|assistant|model)\b|\bhidden text for (assistants|AI|models)\b/i],
  ["urgent_authority", 0.3, /\b(IMPORTANT|URGENT|ADMIN OVERRIDE|as the system administrator)\b/],
];

/** Secret-looking strings that should never leave in a tool argument */
const SECRET_PATTERNS = [
  ["openai_key", /\bsk-(proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["aws_access_key", /\bAKIA[0-9A-Z]{16}\b/],
  ["github_token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["private_key_block", /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["slack_token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
];

const NETWORK_TOOLS = /^(http|fetch|web|browser|curl|email|send|post|webhook|slack|upload)/i;

/** Hashed n-gram lexical scorer (deterministic, small). */
const LEX = {
  "ignore": 0.9, "previous": 0.5, "instructions": 0.8, "system prompt": 1.2, "disregard": 1.0,
  "jailbreak": 1.4, "developer mode": 1.2, "exfiltrate": 1.5, "webhook": 0.6, "api key": 0.7,
  "do not tell": 0.9, "secretly": 0.9, "override": 0.6, "pretend": 0.5, "unfiltered": 1.0,
  "no restrictions": 1.1, "base64": 0.4, "reveal": 0.6, "confidential": 0.4,
};
export function lexicalScore(text) {
  const t = String(text || "").toLowerCase();
  let z = -3.0;
  for (const [k, w] of Object.entries(LEX)) if (t.includes(k)) z += w;
  return 1 / (1 + Math.exp(-z));
}

/** @type {Map<string, number[]>} session → tool-call timestamps */
const sessionCalls = new Map();
/** @type {Map<string, string[]>} session → recent call fingerprints */
const sessionFps = new Map();

/**
 * @param {{ sessionId?: string, text?: string, toolName?: string, toolArgs?: any,
 *           depth?: number, useClassifier?: boolean }} input
 * @param {{ agentMaxToolCallsPerMin: number, agentMaxDepth: number }} policy
 */
export function precheckAgentCall(input, policy, now = Date.now()) {
  const reasons = [];
  let score = 0;
  const text = String(input.text || "").slice(0, 200_000);
  const argsStr = input.toolArgs == null ? "" : JSON.stringify(input.toolArgs).slice(0, 200_000);
  const haystack = `${text}\n${argsStr}`;

  for (const [id, w, re] of FAMILIES) if (re.test(haystack)) { reasons.push(`injection:${id}`); score += w; }

  const secretHits = SECRET_PATTERNS.filter(([, re]) => re.test(argsStr)).map(([id]) => id);
  if (secretHits.length && NETWORK_TOOLS.test(String(input.toolName || ""))) {
    reasons.push(...secretHits.map((s) => `exfiltration:secret_in_network_tool:${s}`));
    score += 1.0;
  }

  if (input.useClassifier) {
    const p = lexicalScore(haystack);
    if (p >= 0.5) { reasons.push(`classifier:${p.toFixed(2)}`); score += 0.4; }
  }

  const sid = input.sessionId ? String(input.sessionId).slice(0, 128) : null;
  if (sid && input.toolName) {
    const arr = sessionCalls.get(sid) || [];
    while (arr.length && now - arr[0] >= 60_000) arr.shift();
    arr.push(now);
    sessionCalls.set(sid, arr);
    if (arr.length > policy.agentMaxToolCallsPerMin) { reasons.push(`tool_abuse:velocity:${arr.length}/min`); score += 1.0; }

    const fp = crypto.createHash("sha1").update(`${input.toolName}|${argsStr}`).digest("hex");
    const fps = sessionFps.get(sid) || [];
    fps.push(fp);
    if (fps.length > 20) fps.shift();
    sessionFps.set(sid, fps);
    const repeats = fps.filter((x) => x === fp).length;
    if (repeats >= 5) { reasons.push(`tool_abuse:loop:same_call_x${repeats}`); score += 1.0; }
  }

  const depth = Number(input.depth || 0);
  if (depth > policy.agentMaxDepth) { reasons.push(`recursive_spend:depth_${depth}>${policy.agentMaxDepth}`); score += 1.0; }

  const verdict = score >= 0.6 ? "block" : score >= 0.3 ? "flag" : "allow";
  return { verdict, score: Math.round(score * 100) / 100, reasons };
}

export function resetAgentGuard() {
  sessionCalls.clear();
  sessionFps.clear();
}
