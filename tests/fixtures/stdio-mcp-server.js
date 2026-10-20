// Minimal stdio MCP server used by tests: one clean tool and one poisoned tool.
import readline from "node:readline";
import { demoServers } from "../../src/mcp/demoServers.js";
const s = demoServers["demo-poisoned"];
readline.createInterface({ input: process.stdin }).on("line", async (l) => { const r = await s.handle(JSON.parse(l)); if (r) process.stdout.write(JSON.stringify(r) + "\n"); });
