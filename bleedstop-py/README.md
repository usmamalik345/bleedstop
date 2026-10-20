# bleedstop-py

Async Python client and FastAPI integration for the BleedStop cost-abuse control plane. Same `guarded()` semantics as the Node SDK.

```bash
pip install -e ".[fastapi]"      # dev: pip install -e ".[dev]"
```

```python
from bleedstop import BleedStopClient, DecideRequest

async with BleedStopClient("http://localhost:3000", api_key="...") as bs:
    g = await bs.guarded(
        DecideRequest(actorId=user_id, action="llm.call", idempotencyKey=request_id,
                      estimatedTokens=prompt_tokens + max_tokens,
                      signals={"deviceFingerprint": fp, "email": email, "ip": client_ip}),
        lambda d: call_llm(max_tokens=d.limit.maxTokens if d.limit else 512),
    )
    if not g.ok:
        ...  # DENY or CHALLENGE: nothing was spent
```

FastAPI:

```python
from bleedstop.fastapi import BleedStopGuard
guard = BleedStopGuard(bs)

@app.post("/ai/rewrite")
async def rewrite(body: Body, d: Decision = Depends(guard.protect("llm.call", context=build_request))):
    ...
```

| Outcome | `guarded()` | FastAPI dependency |
|---|---|---|
| ALLOW | runs fn | passes Decision |
| LIMIT | runs fn with `decision.limit` | passes Decision |
| CHALLENGE | fn not run, `ok=False` | 403 `BLEEDSTOP_CHALLENGE` |
| DENY | fn not run, `ok=False` | 429 `BLEEDSTOP_DENY` |
| same `idempotencyKey` running or done | stored result, `replay=True`, fn not re-run (also for parallel retries) | |
| BleedStop down / 5xx / timeout / control plane rate limit | fail policy: login+signup open, SMS/payments/email closed, LLM local cap (LIMIT, 200 tokens) | closed → 503 `BLEEDSTOP_FAIL_CLOSED` |
| 4xx from BleedStop (caller bug) | raises `BleedStopError` | |

Typed with pydantic v2 (`extra="forbid"` on requests, forward compatible responses), `mypy --strict` clean.

Tests: `pytest` (16 unit tests with respx mocks and FastAPI TestClient). End to end against a running server: `BLEEDSTOP_URL_IT=http://localhost:3000 pytest tests/test_integration.py` (2 tests: token flood denied, shared-device farm capped at 60 calls by the velocity rule, invalid input and agent injection denied).

Example app with a deterministic token-billing mock LLM: `examples/app.py`.
