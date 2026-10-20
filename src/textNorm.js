/**
 * Text cleanup before a detector. Off unless BLEEDSTOP_NORMALIZE=1.
 * The eval script calls normalizeForDetect directly so it can compare on and off.
 * Unicode form, invisible characters, leetspeak, and a decoded base64 copy
 * are added beside the original so a phrase list can see them.
 */
export function normalizeForDetect(text) {
  const raw = String(text || "");
  const flat = raw.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF\u2060]/g, "");
  const leet = flat
    .replace(/[@4]/g, "a")
    .replace(/3/g, "e")
    .replace(/1/g, "i")
    .replace(/0/g, "o")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/\$/g, "s");
  const decoded = [];
  for (const m of flat.match(/\b[A-Za-z0-9+/]{16,}={0,2}\b/g) || []) {
    const buf = Buffer.from(m, "base64");
    if (!buf.length || buf.toString("base64").replace(/=+$/, "") !== m.replace(/=+$/, "")) continue;
    const t = buf.toString("utf8");
    if (/^[\t\n\r\x20-\x7e]+$/.test(t) && /[a-z]/i.test(t)) decoded.push(t);
  }
  const parts = [flat];
  if (leet !== flat) parts.push(leet);
  parts.push(...decoded);
  return parts.join("\n");
}

/** Copy the agent input with normalized text when the flag is on. Default leaves text unchanged. */
export function prepareAgentInput(input) {
  if (!input || String(process.env.BLEEDSTOP_NORMALIZE || "") !== "1" || input.text == null) return input;
  return { ...input, text: normalizeForDetect(input.text) };
}
