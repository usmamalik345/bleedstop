# Real database (not just JavaScript memory)

## What you want

Data should live in **Postgres**, so if the server restarts, bills/incidents/RAG still exist.

## How BleedStop does it

1. **Hot path** still reads a fast in-memory cache (so `/decide` stays quick).
2. Every change is **also written to Postgres**.
3. On boot, BleedStop **loads Postgres → memory** (`hydrateFromDatabase`).

| Data | Postgres table |
|------|----------------|
| Cluster bills | `cluster_spend` |
| Reservations | `reservations` |
| App key spend | `app_key_spend` |
| Vendor usage + key status | `vendor_keys` |
| Incidents | `incidents` |
| Events | `events` |
| Cluster graph | `cluster_actors`, `cluster_signals`, `cluster_labels` |
| RAG chunks | `rag_chunks` |

## Run it

```bash
# 1) Start Postgres + Redis
npm run db:up

# 2) Make sure .env has DATABASE_URL (already added)
# DATABASE_URL=postgres://bleedstop:bleedstop@localhost:5434/bleedstop

# 3) Start API
npm start
```

Check health:

`http://localhost:3000/api/health`

You should see:

```json
"storage": "postgres",
"infra": { "postgres": true, ... }
```

## Prove data is real

1. Run `npm run demo:ghost`
2. Stop the server (Ctrl+C)
3. Start again: `npm start`
4. Open `/ledger` — spend + disabled key should still be there

## Or run the full stack in Docker

```bash
npm run stack:up
```

This runs API + Postgres + Redis + reconciler together.
