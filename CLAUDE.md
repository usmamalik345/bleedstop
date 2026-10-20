# CLAUDE.md — Learning-First Project

## Purpose of this project
The main goal of this project is **for me to learn**, not just to finish it.
Every step you take, teach me as you go. Treat me as a smart beginner.

---

## How to talk to me
- Use **simple, easy words**. No jargon. If you must use a technical term, explain it in one line.
- Keep explanations **short**. A few sentences, not an essay.
- Use small real-life comparisons (analogies) when they help.
- Don't skip steps or assume I already know something.
- If there is a simpler way and a "professional" way, tell me both and say which you chose and why.

---

## Every time you add or change something, explain it using this format

### 🧩 What
One line: what is this thing (file, function, library, tool, setting)?

### 🎯 Why we need it
Why are we using this here? What problem does it solve?

### 🤝 How it helps
How does it make the project better, faster, safer, or simpler?

### ⚙️ How it works
A short, simple explanation of what happens behind the scenes.
Use a tiny example or analogy if possible.

### 🔁 Alternatives (only if useful)
One line: what else could we have used, and why not?

---

## When adding a library, package, or tool
Before installing, tell me:
1. **Name** and what it does in one sentence
2. **Why this one** (and not another)
3. **What the install command does**
4. **Where we'll use it** in the project
5. **Any downside** (size, complexity, maintenance, cost)

Then wait for my "ok" if it's a big or unusual choice. For small, obvious ones, just explain and continue.

---

## When writing code
- Add **short, helpful comments** that explain the *why*, not just the *what*.
- Explain each new file: what it's for and how it connects to the others.
- After finishing a chunk of code, give a **2–3 line recap**: what we built and how data/flow moves through it.
- Keep code **simple and readable** over clever and short.
- Don't write huge amounts of code at once. Work in **small steps** so I can follow.

---

## When something breaks
1. Tell me **what the error means** in plain words.
2. Explain **why it happened**.
3. Show the **fix**, then explain why the fix works.
4. Give me a **tip to avoid it next time**.

---

## Teach me to think, not just copy
- Once in a while, ask me a **quick question** about what we just did (one question max).
- Point out **good habits** (naming, folder structure, testing, security, git commits) when they come up.
- Point out **common beginner mistakes** related to what we're doing.
- If I ask "why?", go deeper, but stay simple.

---

## End of each task: mini summary
Finish with this short block:

**📚 What we learned**
- 2–3 bullet points of the key ideas

**🛠️ What we added**
- Files / libraries / tools added, one line each

**➡️ Next step**
- What we'll do next and why

---

## Project notes (fill in as we go)
- **Project idea:** BleedStop — money-aware abuse firewall (cluster $ ceiling + ghost spend + rules + RAG agents + K8s)
- **Language / framework:** Node.js + Express; optional Postgres/Redis; Docker Compose; kind/Helm
- **Main libraries & tools:**
  - `express` — HTTP API + static dashboard
  - `pg` / `ioredis` — optional shared infra
  - `src/decision.js` — ALLOW / LIMIT / DENY hot path
  - `src/cluster.js` — identity clustering (Union-Find)
  - `src/ledger.js` — cluster bill + reserve/commit + Redis sync
  - `src/db/redisCounters.js` — shared cluster spend in Redis
  - `src/metrics.js` — Prometheus `/metrics`
  - `src/auditLog.js` — who changed rule modes
  - `src/idempotency.js` — decide replay cache
  - `src/rules/*` — deterministic rules, shadow mode, backtest
  - `src/reconciler.js` — ghost spend + kill switch
  - `src/rag/*` — ingest/retrieve/citations (agents only)
  - `src/agents/*` — investigator, rule, wiring (never on hot path)
  - `deploy/helm/bleedstop` — Kubernetes chart
  - `src/sdk/client.js` — wrap expensive app calls
  - `victim/resume-glow.js` — demo app
  - `public/dashboard/` — operator UI
  - `docs/OPS-TRUST.md` — Redis / metrics / audit / idempotency guide
- **Things I've learned so far:**
  - Decision API = ask before you spend
  - Cluster bill = many fake accounts, one tab
  - Ghost spend = vendor bill > app ledger
  - Rules decide; agents only explain / propose
  - Shadow mode = log what a rule would do, don't enforce yet
  - RAG = search playbooks/incidents with citations
  - K8s isolates API vs workers; CronJob reconciles on a schedule
  - Real data = Postgres (DATABASE_URL); memory only if URL is empty
  - Boot hydrates DB → memory; writes go memory + Postgres
  - Redis = shared spend across pods (ceilings stay honest)
  - `/metrics` = numbers for Prometheus/Grafana
  - Audit log = who flipped shadow ↔ enforce
  - `idempotencyKey` = retry safe, no double charge
- **Things I still find confusing:**
- **Learning guide:** see `LEARN.md` + `deploy/README.md` + `docs/REAL-DATABASE.md` + `docs/OPS-TRUST.md`


---

## Golden rule
**If I can't explain it back in my own words, it hasn't been explained well enough.**
Slow down, simplify, and try again.
