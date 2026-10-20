import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { initTracing, withSpan, shutdownTracing } from "../src/tracing.js";

test("withSpan exports a span with attributes", async () => {
  const exp = new InMemorySpanExporter();
  await initTracing({ exporter: exp });
  await withSpan("bleedstop.decide", { "bleedstop.action": "llm.call" }, async (s) => s.setAttribute("bleedstop.decision", "DENY"));
  const spans = exp.getFinishedSpans();
  assert.equal(spans.length, 1);
  assert.equal(spans[0].name, "bleedstop.decide");
  assert.equal(spans[0].attributes["bleedstop.decision"], "DENY");
  await shutdownTracing();
});
