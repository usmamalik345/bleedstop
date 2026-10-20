# Learn advanced RAG locally (no OpenAI account)

## What we added

1. **pgvector** — Postgres stores embeddings as vectors and searches by similarity  
2. **Hybrid retrieve** — vector score + keyword score  
3. **Ollama mode** — local free LLM writes investigator summaries from RAG chunks  

`/decide` still never calls an LLM.

## One-time: recreate Postgres with pgvector

Old `postgres:16-alpine` volume has no vector extension. Recreate (this **wipes DB data**):

```powershell
cd "E:\Bot check"
docker compose down
docker volume ls
# find the volume name ending with _pgdata, then:
docker volume rm "botcheck_pgdata"
# if name differs, use the exact name from `docker volume ls`
npm run db:up
```

Then restart BleedStop (`npm start`). Boot log should say: `pgvector ready`.

Check:

```powershell
Invoke-RestMethod http://localhost:3000/rag/status
```

Look for `"pgvector": true`.

## Optional: local LLM with Ollama

1. Install from https://ollama.com  
2. Pull a small model:

```powershell
ollama pull llama3.2
```

3. In `.env`:

```env
AGENT_MODE=ollama
OLLAMA_MODEL=llama3.2
```

4. Restart `npm start`  
5. Cause an incident (red team / drill), open dashboard Investigator — summary should say `mode: ollama`.

If Ollama is off, agent falls back to template text (still works).

## How to practice (learning loop)

1. `GET /rag/search?q=ghost+spend` — see chunks + `engine: pgvector`  
2. Flip `AGENT_MODE` between `template` and `ollama` — same RAG, different writer  
3. Later, when you have OpenAI: `AGENT_MODE=llm` + `OPENAI_API_KEY`

## Mental model

| Layer | Job |
|-------|-----|
| Embed | Text → numbers |
| pgvector | Find similar numbers fast |
| Hybrid | Blend meaning + exact words |
| Ollama/OpenAI | Write readable report from those chunks |
| Citations | Prove the report used real sources |

## Honest limits

- Local `embed.js` is a small teaching embedding (64-d), not OpenAI-quality  
- Upgrade later: Ollama `nomic-embed-text` or OpenAI embeddings — same retrieve interface  
- Recreating the DB volume clears ledger/incidents; re-run drill after
