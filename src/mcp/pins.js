/**
 * Tool pinning (rug pull protection). Pins are keyed by tenant + upstream server + tool name.
 * Trust on first use by default; a pin file (MCP_PINS_FILE, JSON {"server/tool": "sha256"})
 * makes pins explicit and reviewable. A changed fingerprint fails closed in enforce mode.
 */
import fs from "node:fs";
import { fingerprintTool } from "./toolScan.js";

/** @type {Map<string, { hash: string, firstSeen: number, source: "tofu"|"file" }>} */
const pins = new Map();
let filePins = null;
function loadFilePins() {
  if (filePins) return filePins;
  filePins = {};
  const f = process.env.MCP_PINS_FILE;
  if (f && fs.existsSync(f)) filePins = JSON.parse(fs.readFileSync(f, "utf8"));
  return filePins;
}
const key = (tenant, server, tool) => `${tenant}|${server}|${tool}`;

/** @returns {{ status: "pinned_new"|"match"|"changed", hash: string, pinned?: string }} */
export function checkPin(tenant, server, tool, now = Date.now()) {
  const hash = fingerprintTool(tool);
  const k = key(tenant, server, tool.name);
  const fromFile = loadFilePins()[`${server}/${tool.name}`];
  const existing = pins.get(k) || (fromFile ? { hash: fromFile, firstSeen: 0, source: "file" } : null);
  if (!existing) { pins.set(k, { hash, firstSeen: now, source: "tofu" }); return { status: "pinned_new", hash }; }
  if (!pins.has(k)) pins.set(k, existing);
  return existing.hash === hash ? { status: "match", hash } : { status: "changed", hash, pinned: existing.hash };
}
export function getPin(tenant, server, toolName) { return pins.get(key(tenant, server, toolName))?.hash || loadFilePins()[`${server}/${toolName}`] || null; }
export function listPins(tenant) { return [...pins.entries()].filter(([k]) => k.startsWith(`${tenant}|`)).map(([k, v]) => ({ tool: k.split("|").slice(1).join("/"), ...v })); }
export function resetPins() { pins.clear(); filePins = null; }
export function resetPinsFor(tenant, server) { for (const k of [...pins.keys()]) if (k.startsWith(`${tenant}|${server}|`)) pins.delete(k); }
