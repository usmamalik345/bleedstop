"""Example FastAPI app: free-tier AI rewrite behind BleedStop, calling a deterministic mock LLM.

    BLEEDSTOP_URL=http://localhost:3000 uvicorn examples.app:app --port 5100
"""
from __future__ import annotations

import math
import os
from typing import Optional

from fastapi import Depends, FastAPI, Request
from pydantic import BaseModel, Field

from bleedstop import BleedStopClient, DecideRequest, Decision
from bleedstop.fastapi import BleedStopGuard

PRICE_IN, PRICE_OUT = 2.5 / 1e6, 10 / 1e6  # USD per token (assumption, same as Node suite)


class MockLLM:
    """Deterministic: tokens = ceil(chars/4), output = min(max_tokens, 200)."""
    def __init__(self) -> None:
        self.calls = 0
        self.usd = 0.0

    async def complete(self, prompt: str, max_tokens: int) -> dict[str, float]:
        tin, tout = math.ceil(len(prompt) / 4), min(max_tokens, 200)
        cost = tin * PRICE_IN + tout * PRICE_OUT
        self.calls += 1
        self.usd += cost
        return {"input_tokens": tin, "output_tokens": tout, "cost_usd": cost}


class RewriteBody(BaseModel):
    actorId: str = Field(min_length=1, max_length=200)
    text: str = Field(max_length=2_000_000)
    deviceFingerprint: Optional[str] = None
    email: Optional[str] = None
    maxTokens: int = Field(default=512, ge=1, le=8192)


def create_app(client: Optional[BleedStopClient] = None, llm: Optional[MockLLM] = None) -> FastAPI:
    app = FastAPI(title="ResumeGlow (Python) behind BleedStop")
    bs = client or BleedStopClient(base_url=os.getenv("BLEEDSTOP_URL", "http://localhost:3000"),
                                   api_key=os.getenv("BLEEDSTOP_API_KEY"))
    model = llm or MockLLM()
    app.state.llm = model
    guard = BleedStopGuard(bs)

    async def ctx(request: Request) -> DecideRequest:
        b = RewriteBody.model_validate(await request.json())
        return DecideRequest(
            actorId=b.actorId, action="llm.call", paid=False,
            idempotencyKey=request.headers.get("idempotency-key"),
            estimatedTokens=math.ceil(len(b.text) / 4) + b.maxTokens,  # computed server side
            signals={"deviceFingerprint": b.deviceFingerprint, "email": b.email,
                     "ip": request.client.host if request.client else None},
        )

    @app.post("/ai/rewrite")
    async def rewrite(body: RewriteBody, d: Decision = Depends(guard.protect("llm.call", context=ctx))) -> dict[str, object]:
        max_tokens = min(body.maxTokens, d.limit.maxTokens) if d.limit and d.limit.maxTokens else body.maxTokens
        out = await model.complete(body.text, max_tokens)
        return {"decision": d.decision.value, "degraded": d.degraded, **out}

    @app.get("/bill")
    async def bill() -> dict[str, float]:
        return {"calls": model.calls, "usd": round(model.usd, 6)}

    return app


app = create_app()
