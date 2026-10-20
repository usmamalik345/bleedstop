/**
 * OpenTelemetry tracing (ADR-0005). The API package is always used (no-op by default);
 * the SDK + OTLP/HTTP exporter only start when OTEL_EXPORTER_OTLP_ENDPOINT is set,
 * or a test installs an in-memory exporter. Prometheus /metrics is unchanged.
 */
import { trace, SpanStatusCode } from "@opentelemetry/api";

export const tracer = () => trace.getTracer("bleedstop", "0.5.0");
let provider = null;

export async function initTracing({ exporter } = {}) {
  if (provider) return provider;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!exporter && !endpoint) return null;
  const { NodeTracerProvider, BatchSpanProcessor, SimpleSpanProcessor } = await import("@opentelemetry/sdk-trace-node");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  let proc;
  if (exporter) proc = new SimpleSpanProcessor(exporter);
  else {
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    proc = new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, "")}/v1/traces` }));
  }
  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": process.env.OTEL_SERVICE_NAME || "bleedstop",
      "service.version": "0.5.0",
      "service.instance.id": process.env.INSTANCE_ID || String(process.pid),
    }),
    spanProcessors: [proc],
  });
  provider.register();
  return provider;
}

export async function shutdownTracing() { if (provider) await provider.shutdown(); provider = null; }

/** Run fn inside an active span; records exceptions and sets status. */
export async function withSpan(name, attrs, fn) {
  return tracer().startActiveSpan(name, { attributes: attrs }, async (span) => {
    try {
      const out = await fn(span);
      return out;
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw err;
    } finally {
      span.end();
    }
  });
}
