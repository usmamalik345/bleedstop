#!/usr/bin/env node
/**
 * stdio MCP gateway: put BleedStop between an MCP client and a local stdio MCP server.
 *   node bin/mcp-gateway-stdio.js --server files --tenant local-dev [--mode shadow] -- npx -y @modelcontextprotocol/server-filesystem /tmp
 * In an MCP client config, use this command instead of the server command. Messages are newline
 * delimited JSON-RPC. tools/list is pinned and scanned; tools/call goes through the full decision.
 * Logs go to stderr (stdout is the protocol channel).
 */
import { spawn } from "node:child_process";
import readline from "node:readline";
import { handleMcpMessage, registerUpstream } from "../src/mcp/gateway.js";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep < 0 || sep === argv.length - 1) { process.stderr.write("usage: mcp-gateway-stdio [--server id] [--tenant id] [--mode shadow|enforce] -- <command> [args]\n"); process.exit(2); }
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && i < sep ? argv[i + 1] : d; };
const serverId = opt("server", "stdio"), tenantId = opt("tenant", process.env.TENANT_ID || "local-dev"), mode = opt("mode", process.env.MCP_GATEWAY_MODE || "enforce");

const child = spawn(argv[sep + 1], argv.slice(sep + 2), { stdio: ["pipe", "pipe", "inherit"] });
const pending = new Map();
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
readline.createInterface({ input: child.stdout }).on("line", (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id != null && pending.has(m.id) && (m.result !== undefined || m.error !== undefined)) { pending.get(m.id)(m); pending.delete(m.id); }
  else send(m); // server notifications / requests pass through
});
registerUpstream(serverId, {
  handle(msg) {
    child.stdin.write(JSON.stringify(msg) + "\n");
    if (msg.id == null) return Promise.resolve(null);
    return new Promise((resolve) => pending.set(msg.id, resolve));
  },
});
let chain = Promise.resolve(); // process client messages in order (tools/list must pin before tools/call)
readline.createInterface({ input: process.stdin }).on("line", (line) => { chain = chain.then(() => onClientLine(line)); });
async function onClientLine(line) {
  let msg; try { msg = JSON.parse(line); } catch { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  if (msg.method == null) { child.stdin.write(line + "\n"); return; } // client responses to server requests
  try {
    const r = await handleMcpMessage({ tenantId, serverId, msg, mode, sessionId: `stdio-${process.pid}` });
    if (r.decision && r.decision.decision !== "ALLOW") process.stderr.write(`[bleedstop] ${mode} ${msg.params?.name}: ${r.decision.decision} ${r.decision.reasons.join("; ")}\n`);
    if (r.response) send(r.response);
  } catch (err) { send({ jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32603, message: err.message } }); }
}
child.on("exit", (code) => process.exit(code ?? 0));
process.stdin.on("end", () => chain.then(() => child.stdin.end()));
