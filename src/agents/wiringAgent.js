/**
 * Wiring agent (OFF hot path).
 * Produces a PR-style patch suggestion for the victim app.
 * It NEVER merges code — humans do.
 */

import { retrieve } from "../rag/retrieve.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runWiringAgent() {
  const retrieved = await retrieve(
    "server-side key wiring edge function never expose browser API key",
    { k: 3 }
  );

  const victimPath = path.join(__dirname, "..", "..", "victim", "resume-glow.js");
  let victimSnippet = "";
  try {
    const src = await fs.readFile(victimPath, "utf8");
    victimSnippet = src.split("\n").slice(0, 40).join("\n");
  } catch {
    victimSnippet = "(victim app not found)";
  }

  const pr = {
    title: "chore(security): keep vendor keys server-side behind BleedStop",
    body: [
      "## Why",
      "Ghost spend / leaked key risk: client-visible keys can be billed outside the app.",
      "",
      "## Changes",
      "- Ensure OpenAI/Gemini/Twilio keys stay in server env only",
      "- Call BleedStop `/decide` before paid vendor calls (already in SDK path)",
      "- Add comment checklist for vibe-coded apps",
      "",
      "## Evidence (RAG)",
      ...retrieved.map((r) => `- ${r.chunk_id}: ${r.title}`),
      "",
      "Human must review and merge. Agent will not auto-merge.",
    ].join("\n"),
    files: [
      {
        path: "victim/resume-glow.js",
        note: "Already uses SDK guarded(); keep vendorKeyId server-side only.",
        head_snapshot: victimSnippet,
      },
      {
        path: ".env.example",
        patch: [
          "BLEEDSTOP_URL=http://localhost:3000",
          "OPENAI_API_KEY=replace-me",
          "TWILIO_AUTH_TOKEN=replace-me",
          "# NEVER put these in frontend bundles",
        ].join("\n"),
      },
    ],
  };

  return {
    agent: "wiring",
    status: "pr_draft",
    retrieved,
    pullRequest: pr,
    safety: "No git push/merge from this agent. Output is a draft only.",
  };
}
