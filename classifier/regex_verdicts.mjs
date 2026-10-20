// stdin: JSONL {"text": ...}  stdout: JSONL {"verdict": "allow|flag|block", "us": microseconds}
import readline from "node:readline";
import { precheckAgentCall, resetAgentGuard } from "../src/agentGuard.js";
const POLICY = { agentMaxToolCallsPerMin: 30, agentMaxDepth: 5 };
const rl = readline.createInterface({ input: process.stdin });
for await (const line of rl) {
  if (!line.trim()) continue;
  const { text } = JSON.parse(line);
  resetAgentGuard();
  const t0 = process.hrtime.bigint();
  const v = precheckAgentCall({ text }, POLICY);
  process.stdout.write(JSON.stringify({ verdict: v.verdict, us: Number(process.hrtime.bigint() - t0) / 1000 }) + "\n");
}
