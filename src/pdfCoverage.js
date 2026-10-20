/**
 * Honest map of the PDF vs what you can test on this laptop.
 */

export function pdfCoverage() {
  return {
    youCanTestNow: [
      "Decision API ALLOW / LIMIT / DENY / CHALLENGE",
      "Unpaid $5 and paid $50 cluster ceilings",
      "Parallel race: 20 card tests, only one charge",
      "Fail policy: login open, SMS closed, LLM local cap",
      "OTP freeze + key disable runbooks (reversible, audited)",
      "Ghost spend reconcile + Slack hook",
      "Shadow rules + audit log",
      "Idempotency replay",
      "Redis shared spend (when REDIS_URL is set)",
      "Prometheus /metrics",
      "RAG retrieve + citations (agents only)",
      "In-memory queue + dead letter",
      "Drill scenarios + bill-shock audit",
      "Dashboard",
    ],
    needsYourCloudAccount: [
      "Live OpenAI/Twilio usage API pull (admin keys)",
      "k3s on Oracle, EKS, Terraform",
      "Argo CD GitOps and GHCR",
      "KEDA + RabbitMQ (local queue stands in)",
      "pgvector + hosted reranker (local hybrid search stands in)",
      "Real LLM agent + GitHub PR sandbox",
      "Grafana / OpenTelemetry stack",
      "500 rps k6 proof on a kind cluster",
      "Bill-shock audit against a founder's real vendor keys",
    ],
  };
}
