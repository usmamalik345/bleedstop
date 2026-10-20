"""Async BleedStop client with guarded() semantics identical to the Node SDK.

guarded(request, fn):
  * DENY / CHALLENGE  -> fn is NOT called, ok=False
  * ALLOW / LIMIT     -> fn(decision) is called (LIMIT carries decision.limit)
  * same idempotencyKey (running or finished) -> stored result reused, fn not re-run
  * BleedStop unreachable / 5xx / timeout -> per-action fail policy (open | closed | local_cap)
  * 4xx (bad request, auth)               -> raised as BleedStopError (caller bug, never silent)
"""
from __future__ import annotations

import asyncio
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Generic, Optional, TypeVar

import httpx

from .models import DecideRequest, Decision, Verdict
from .policy import fallback_decision

T = TypeVar("T")


class BleedStopError(RuntimeError):
    def __init__(self, status: int, body: Any) -> None:
        super().__init__(f"BleedStop {status}: {body}")
        self.status = status
        self.body = body


@dataclass
class Guarded(Generic[T]):
    ok: bool
    decision: Decision
    result: Optional[T] = None
    replay: bool = False


class BleedStopClient:
    def __init__(
        self,
        base_url: str = "http://localhost:3000",
        api_key: Optional[str] = None,
        timeout_s: float = 2.5,
        http: Optional[httpx.AsyncClient] = None,
        max_cached: int = 5000,
    ) -> None:
        headers = {"content-type": "application/json"}
        if api_key:
            headers["x-api-key"] = api_key
        self._http = http or httpx.AsyncClient(base_url=base_url, timeout=timeout_s, headers=headers)
        self._owns_http = http is None
        self._executed: "OrderedDict[str, asyncio.Future[Guarded[Any]]]" = OrderedDict()
        self._max_cached = max_cached

    async def __aenter__(self) -> "BleedStopClient":
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    async def decide(self, request: DecideRequest) -> Decision:
        """Raw /decide. Applies fail policy on transport errors and 5xx/429-from-proxy."""
        payload = request.model_dump(exclude_none=True)
        try:
            res = await self._http.post("/decide", json=payload)
        except (httpx.TransportError, httpx.TimeoutException) as err:
            return fallback_decision(request.action, type(err).__name__)
        if res.status_code >= 500:
            return fallback_decision(request.action, f"HTTP {res.status_code}")
        if res.status_code == 429 and res.json().get("code") == "BLEEDSTOP_DECIDE_RATE_LIMIT":
            # control plane is shedding load: same as unavailable
            return fallback_decision(request.action, "decide rate limited")
        if res.status_code >= 400:
            raise BleedStopError(res.status_code, res.json())
        return Decision.model_validate(res.json())

    async def guarded(
        self, request: DecideRequest, fn: Callable[[Decision], Awaitable[T]]
    ) -> Guarded[T]:
        key = request.idempotencyKey
        if key and key in self._executed:
            prior = await asyncio.shield(self._executed[key])
            return Guarded(ok=prior.ok, decision=prior.decision, result=prior.result, replay=True)

        loop = asyncio.get_running_loop()
        fut: "asyncio.Future[Guarded[Any]]" = loop.create_future()
        if key:
            self._executed[key] = fut
            while len(self._executed) > self._max_cached:
                self._executed.popitem(last=False)
        try:
            decision = await self.decide(request.model_copy(update={"mode": "auto"}))
            if decision.decision in (Verdict.DENY, Verdict.CHALLENGE):
                out: Guarded[Any] = Guarded(ok=False, decision=decision)
                if key:
                    self._executed.pop(key, None)  # denied attempts may retry later
            else:
                out = Guarded(ok=True, decision=decision, result=await fn(decision))
            fut.set_result(out)
            return out
        except BaseException as err:
            if key:
                self._executed.pop(key, None)
            fut.set_exception(err)
            fut.exception()  # mark retrieved
            raise
