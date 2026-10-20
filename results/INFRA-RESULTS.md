# BleedStop infrastructure results (Docker, Postgres mode, Kubernetes)

Run on 2026-10-20 (Asia/Karachi, UTC+5) on one shared Linux box: 8 vCPU, 15 GiB RAM, Debian 13, kernel 6.12.
Load generator, LB and every container share that box, so absolute numbers are a lower bound for a
real cluster and only comparisons inside this file are meaningful. Raw JSON for every number below is in
`results/infra/`. Nothing here is estimated; anything not run is listed under "Not done".

Load test = `benchmark/stack/load.js`: POST /decide, unique actor per request (no denials expected),
1,000 warm up requests, then 20,000 requests at concurrency 64, 3 runs, median reported. "Failed" =
any non 200 or transport error (reset, refused, 10 s timeout).

## 1. Docker Compose: 3x API + Redis 7 + Postgres 16 + nginx (`src-copy/docker-compose.stack.yml`)

Environment: Docker 26.1.5, Compose 2.26.1, overlay2. Workaround needed: the box had legacy iptables
`FORWARD DROP` rules that blocked container to container traffic on user bridges (Postgres connect
ETIMEDOUT); fixed on the box with `iptables-legacy -I DOCKER-USER -i br-+ -j ACCEPT` (and `-o br-+`).

| Test | Result |
|---|---|
| Golden set evals via LB (12,140 requests) | precision 100.0%, FP rate 0.0%, recall 48.0%, TP 4,414; identical to single process memory mode (4,414 TP, 0 FP); eval gate passed |
| Same, before fix 1 below | TP 3,083, rotated_same_subnet recall 0.15% (3 of 2,000) vs 66.7% single instance |
| Attack suite via LB (3 runs, median) | shared device farm 97% blocked, rotating all signals 66.7%, 400k char token flood 100%, retry storm 94%, same idempotency key retry storm 999 of 1,000 replayed (99.9% upstream calls prevented), 0% on normal traffic; added latency p50 2.38 ms, p95 3.13 ms |
| Load, Postgres ON (runs 5,151 / 5,521 / 5,433 rps) | median 5,433 decisions/s, p50 10.4 to 11.2 ms, median p99 36.2 ms, 0 failed of 60,000 |
| Load, Postgres OFF (runs 5,091 / 5,896 / 5,844 rps) | median 5,844 decisions/s, median p99 38.8 ms, 0 failed |
| Durability after the 3 PG ON runs | 66,000 budget_ledger rows for 66,000 charged decisions (incl. 3,000 from the attack suite) |
| Postgres stopped for ~7 s mid load (20 s, c=32) | 86,071 requests, 0 failed, p99 25.2 ms; buffered rows drained after restart; 86,071 of 86,071 ledger rows persisted, 0 dropped |
| Sequential `docker restart` of the 3 API containers under load (40 s, c=32) | 157,239 requests, 39 failed (nginx 502, 0.025%); nginx has no readiness probe and does not retry POST |

## 2. Postgres durable mode

What exists now (`src/db/`): versioned SQL migrations (`migrations/0001_init.sql`, `0002_durable_state.sql`,
runner `migrate.js` with `pg_advisory_lock`, `schema_migrations` with sha256, edited file fails boot,
`node src/db/migrate.js --status`), tables for tenants, versioned tenant policy snapshots (sha256 of effective
policy), append only `budget_ledger` (one row per charged decision), audit log protected by a trigger that
rejects UPDATE/DELETE (verified: `ERROR: audit_events is append only`), events, cluster spend and identity graph.
Writes go through a batched write behind (`writeBehind.js`, 50 ms flush, one transaction, json_to_recordset bulk
statements, bounded buffer, Prometheus `bleedstop_pg_*` metrics). `PG_REQUIRED=1` exits instead of silently
running in memory mode.

Bugs found by running it, all fixed:
1. Legacy write path rewrote the whole identity graph (DELETE + re INSERT of every actor) on every new actor and
   ran one serial query per event. Single instance, 5,000 requests: only 41 of 5,200 events were in Postgres
   70 s after the burst. New path: 21,000 of 21,000 events, ledger rows and actors persisted within 1 s; ledger sum
   ($315.00) equals cluster spend sum ($315.00).
2. 3 replicas booting at once: migrations applied exactly once (advisory lock).
3. Event ids were `evt-<ms>-<seq>`, which collide across replicas sharing one Postgres; now carry a per process prefix.
4. `clearTenantData` ran BEGIN/COMMIT on the pool (not one connection); now one client.
5. Unhandled `error` on a checked out pg client crashed 2 of 3 replicas when Postgres was stopped.
6. No connect/query timeouts: one replica's write behind hung forever (67,501 pending rows). Now 3 s / 15 s.
7. Boot hydration loaded every `cluster_spend` row; after the load tests (1,089,733 rows) restarted pods died with
   "JavaScript heap out of memory" (exit 139, CrashLoopBackOff). Now skipped when Redis is authoritative, else
   top 50,000 by spend. After the fix all 6 pods started on the same 1.09M row database.
8. Subnet pool and ASN spread state was per process, so a round robin LB split each subnet across replicas
   (the 0.15% recall above). Now shared in Redis (sorted sets + INCRBY); compose evals match single instance.

Throughput with Postgres on vs off: 5,433 vs 5,844 decisions/s median (about 7% lower), p99 36.2 vs 38.8 ms
(within run to run noise). Durability window is one flush interval (50 ms) on a hard crash; SIGTERM drains.

## 3. Kubernetes (kind v0.24.0, k8s v1.31.0, 1 control plane + 1 worker, Helm 3.16.2, metrics-server 0.7.2)

Workaround needed: kube-proxy iptables mode could not program Service rules on this kernel
(`RULE_APPEND failed`, ClusterIPs unreachable, pod IPs fine); `kubeProxyMode: nftables` in `deploy/kind/cluster.yaml` fixed it.

Original chart, deployed unchanged first: `helm install` hung (post install ingest hook never finished: the RAG
knowledge base `data/kb` is not in this copy), API pods were Ready while silently in memory mode (Postgres refused at
boot) with Redis timing out, because probes hit `/api/health`. Chart fixes: `/readyz` readiness + startup probe and
`/livez` liveness, `maxUnavailable: 0`, PDB (minAvailable 2), no fixed replicas when HPA is on, config checksum
rollouts, `terminationGracePeriodSeconds: 30`, 5 s readiness drain before close, seccomp RuntimeDefault, drop ALL
caps, no privilege escalation, Postgres/Redis readiness probes, NetworkPolicy allowing ingress to Postgres/Redis
(default deny blocked it) and DNS over TCP, CronJob deadline/backoff, ingest job off by default, PG_REQUIRED=1.
Dockerfile runs `node` directly (npm swallowed SIGTERM so the graceful drain never ran) and has a `.dockerignore`.

| Test (via NodePort, kube-proxy nftables) | Result |
|---|---|
| `helm install --wait` | deployed in 6.6 s; API pods restart once while Postgres starts (PG_REQUIRED), then Ready |
| Golden set evals | identical to compose and single process: 4,414 TP, 0 FP, gate passed |
| Load, 3 pods at start (runs 3,840 / 4,528 / 4,052 rps) | median 4,052 decisions/s, median p99 54.3 ms, 0 failed of 60,000 |
| HPA (min 3, max 6, 70% of 50m CPU request) | scaled 3 to 6 during the load test (548% of request) |
| `kubectl rollout restart` of 6 pods under load (90 s, c=32), 5 s drain | 287,403 requests, **0 failed**, p99 33.2 ms; rollout 18 s |
| Same with drain disabled (`shutdownDrainMs=0`) | 186,414 requests, 31 failed (ECONNRESET) |
| Pod force delete under load (60 s) | 197,036 requests, 0 failed |
| SIGKILL of the node process from the node (40 s) | 132,853 requests, 1 failed (ECONNRESET); container restarted |
| SIGSTOP (hung process) under load (70 s) | readiness removed the pod within about 4 s; liveness failed 3 times and kubelet marked it for restart; 222,986 requests, 5 failed (10 s timeouts of requests in flight on the frozen pod). The restarted container then hit bug 7 (heap OOM), which was fixed and redeployed |

## Not done / limits
* NetworkPolicy is NOT enforced in this kind cluster (an unlabeled pod still reached Postgres), so the policies were
  rendered and applied but not verified. Needs Calico or Cilium.
* Everything is on one 8 vCPU box: kind nodes, Postgres, Redis, load generator. No multi node or cloud numbers.
* Postgres is a single pod on emptyDir in the chart (dev only); no HA, backups or PVC tested.
* Agent evals, Python SDK tests and the old scale benchmark were not rerun against the stack.
* The pool ceiling check in Redis is check then increment (not one Lua script), so tiny pool overspend is possible under races.
* 3 Node tests fail both before and after these changes (missing `data/kb` RAG files in this copy).
