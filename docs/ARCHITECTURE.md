# Architecture

```mermaid
flowchart LR
  subgraph Apps["Your apps"]
    N["Node app<br/>SDK guarded() / Express middleware"]
    P["Python app<br/>bleedstop-py + FastAPI dependency"]
    AG["Agent runtime<br/>agent context in /decide"]
  end
  N & P & AG -->|"POST /decide (X-API-Key → tenant)"| LB["Load balancer"]
  LB --> I1["BleedStop instance 1"] & I2["BleedStop instance N"]
  subgraph Inst["Each instance: hot path"]
    V["Validate + /decide rate limit"] --> T["Tenant policy (YAML)"]
    T --> C["Identity clustering<br/>device, email (shared in Redis)"]
    C --> NW["Network signals<br/>/24, /64 pools, ASN spread"]
    NW --> G["Agent guard<br/>injection, exfil, loops, depth"]
    G --> R["Rule engine<br/>ceilings, token cap, velocity,<br/>shadow / enforce"]
    R --> L["Atomic charge"]
  end
  I1 & I2 --> RD[("Redis<br/>Lua ceiling, identity graph,<br/>velocity windows")]
  I1 & I2 --> PG[("Postgres (optional)<br/>events, audit, keys")]
  I1 & I2 --> OBS["/metrics, OTLP traces,<br/>JSON logs, audit log"]
  N & P -->|"only if ALLOW/LIMIT"| VEN["LLM / SMS / payments"]
  VEN -.usage.-> RC["Reconciler<br/>ghost spend → kill switch"]
  PG --> INV["Investigator / rule agents<br/>(off hot path)"]
```

Decision order inside `/decide`: rate limit → validation → tenant policy → idempotency replay → cluster → OTP freeze / key kill switch → rules (agent guard, token cap, velocity, subnet pool, ASN spread, SMS rules, ceilings; DENY > CHALLENGE > LIMIT > ALLOW) → atomic charge → event, metrics, span, log.
