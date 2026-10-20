/**
 * Tool definition security (OWASP ASI02 tool misuse, ASI04 supply chain).
 *  - fingerprintTool(): sha256 over a canonical JSON of {name, description, inputSchema, annotations}
 *    so any change to what the model reads (a "rug pull") changes the pin.
 *  - scanToolDefinition(): deterministic scan of the text an LLM will read for planted instructions
 *    ("tool poisoning"): hidden instruction tags, concealment from the user, sensitive file access,
 *    cross tool shadowing, data smuggling through parameters, invisible unicode, encoded blobs,
 *    plus the generic prompt injection families of the agent guard.
 */
import crypto from "node:crypto";
import { precheckAgentCall } from "../agentGuard.js";

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

export function fingerprintTool(tool) {
  const t = { name: tool?.name ?? "", description: tool?.description ?? "", inputSchema: tool?.inputSchema ?? null, annotations: tool?.annotations ?? null };
  return crypto.createHash("sha256").update(canonical(t)).digest("hex");
}

const POISON_RULES = [
  ["hidden_instruction_tag", /<\s*\/?\s*(important|system|instructions?|secret|hidden|admin|note)\s*>/i],
  ["conceal_from_user", /\b(do not|don'?t|never|must not)\s+(tell|mention|inform|reveal|show|notify|alert)\b[^.\n]{0,40}\b(user|human|them|anyone)\b|\bwithout (telling|informing|notifying|asking) the user\b|\b(user|human)\b[^.\n]{0,20}\b(must not|should not|shouldn'?t|cannot|can'?t) (know|see|notice|be told)\b|\bkeep (this|it) (secret|hidden|confidential) from\b/i],
  ["sensitive_file_access", /(~\/\.ssh|id_rsa|id_ed25519|\.aws\/credentials|mcp\.json|\.cursor\/|claude_desktop_config|\.npmrc|\.git-credentials|\/etc\/passwd|\.kube\/config)|\b(read|cat|open|load|include|attach|send)\b[^.\n]{0,40}\b(\.env\b|private key|ssh key|credentials file)/i],
  ["cross_tool_shadowing", /\bwhen(ever)?\b[^.\n]{0,30}\b(the |any )?[`'"]?[a-z_]{3,40}[`'"]? tool\b[^.\n]{0,20}\b(is )?(called|used|invoked|available)\b|\bbefore (using|calling|invoking) (any|the|this|another) (other )?tool\b|\ball (emails?|messages?|payments?|transfers?)\b[^.\n]{0,40}\b(must|should|have to) (be )?(sent|forwarded|redirected|bcc'?d|cc'?d|copied)\b|\binstead of the (user'?s|requested|original)\b[^.\n]{0,30}\b(recipient|address|account|number)\b/i],
  ["param_smuggling", /\b(pass|put|place|include|embed|insert|add)\b[^.\n]{0,40}\b(its |the |their |file |full |entire )?(content|contents|output|conversation|history|data|text)\b[^.\n]{0,40}\b(as|in|into)\b[^.\n]{0,20}\b(the )?(sidenote|note|notes|parameter|argument|field|param|metadata|comment)\b/i],
  ["exfil_destination", /\b(send|forward|bcc|cc|copy|post|upload|report)\b[^\n]{0,60}([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|https?:\/\/[^\s)]+)/i],
  ["invisible_unicode", /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]|[\u{E0000}-\u{E007F}]/u],
  ["encoded_blob", /[A-Za-z0-9+/]{120,}={0,2}/],
];

/** Collect every string the model will read: description, schema property descriptions/titles/defaults/enums. */
function readableText(tool) {
  const out = [String(tool?.description || "")];
  const walk = (s, depth = 0) => {
    if (!s || typeof s !== "object" || depth > 6) return;
    for (const k of ["description", "title", "default", "examples"]) if (s[k] != null) out.push(typeof s[k] === "string" ? s[k] : JSON.stringify(s[k]));
    if (Array.isArray(s.enum)) out.push(s.enum.join(" "));
    if (s.properties) for (const v of Object.values(s.properties)) walk(v, depth + 1);
    if (s.items) walk(s.items, depth + 1);
  };
  walk(tool?.inputSchema);
  return out.join("\n");
}

/** @returns {{ poisoned: boolean, severity: "none"|"suspicious"|"poisoned", reasons: string[] }} */
export function scanToolDefinition(tool) {
  const text = readableText(tool).slice(0, 100_000);
  const reasons = [];
  for (const [id, re] of POISON_RULES) if (re.test(text)) reasons.push(`tool_poisoning:${id}`);
  const g = precheckAgentCall({ text }, { agentMaxToolCallsPerMin: 1e9, agentMaxDepth: 1e9 });
  for (const r of g.reasons) reasons.push(r);
  // invisible unicode, hidden tags, concealment and shadowing are decisive on their own;
  // a single weaker signal (e.g. one exfil_destination match) is "suspicious" (shadow-logged, not blocked)
  const strong = reasons.filter((r) => !/exfil_destination|encoded_blob|urgent_authority|new_role/.test(r));
  const severity = strong.length >= 1 || reasons.length >= 2 ? "poisoned" : reasons.length ? "suspicious" : "none";
  return { poisoned: severity === "poisoned", severity, reasons };
}
