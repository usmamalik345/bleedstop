"""FastAPI integration.

    bs = BleedStopClient(base_url=...)
    guard = BleedStopGuard(bs)

    @app.post("/ai/rewrite")
    async def rewrite(body: Body, d: Decision = Depends(guard.protect("llm.call", context=ctx_from_request))):
        max_tokens = d.limit.maxTokens if d.limit else 512

The dependency raises 429 on DENY, 403 + challenge hint on CHALLENGE, 503 when the
action fails closed and BleedStop is down. ALLOW/LIMIT pass the Decision to the handler.
"""
from __future__ import annotations

import inspect
from typing import Awaitable, Callable, Optional, Union

from fastapi import HTTPException, Request

from .client import BleedStopClient
from .models import DecideRequest, Decision, Verdict

ContextFn = Callable[[Request], Union[DecideRequest, Awaitable[DecideRequest]]]


async def default_context(request: Request, action: str) -> DecideRequest:
    body = {}
    try:
        body = await request.json()
    except Exception:
        body = {}
    ip = request.client.host if request.client else None
    return DecideRequest.model_validate({
        "actorId": str(body.get("actorId") or request.headers.get("x-actor-id") or ip or "anon"),
        "action": action,
        "paid": bool(body.get("paid", False)),
        "idempotencyKey": request.headers.get("idempotency-key"),
        "signals": {
            "deviceFingerprint": body.get("deviceFingerprint") or request.headers.get("x-device-fingerprint"),
            "email": body.get("email"),
            "ip": ip,
        },
    })


class BleedStopGuard:
    def __init__(self, client: BleedStopClient) -> None:
        self.client = client

    def protect(self, action: str, context: Optional[ContextFn] = None) -> Callable[[Request], Awaitable[Decision]]:
        async def dependency(request: Request) -> Decision:
            if context is None:
                req = await default_context(request, action)
            else:
                maybe = context(request)
                built = await maybe if inspect.isawaitable(maybe) else maybe
                req = built.model_copy(update={"action": action})
            d = await self.client.decide(req)
            request.state.bleedstop = d
            if d.decision == Verdict.DENY:
                status = 503 if d.degraded else 429
                code = "BLEEDSTOP_FAIL_CLOSED" if d.degraded else "BLEEDSTOP_DENY"
                raise HTTPException(status_code=status, detail={"code": code, "reason": d.reason})
            if d.decision == Verdict.CHALLENGE:
                raise HTTPException(status_code=403, detail={"code": "BLEEDSTOP_CHALLENGE", "reason": d.reason})
            return d

        return dependency
