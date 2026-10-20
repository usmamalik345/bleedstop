"""
BleedStop HTTP client for Python / FastAPI apps.

Same idea as Node SDK: ask /decide before spending money.
"""

from __future__ import annotations

import os
from typing import Any

import httpx


class BleedStopClient:
    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        timeout_s: float = 2.5,
    ) -> None:
        self.base_url = (base_url or os.getenv("BLEEDSTOP_URL") or "http://localhost:3000").rstrip(
            "/"
        )
        self.api_key = api_key if api_key is not None else os.getenv("BLEEDSTOP_API_KEY", "")
        self.timeout_s = timeout_s

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        return headers

    async def decide(self, body: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout_s) as client:
            res = await client.post(
                f"{self.base_url}/decide",
                headers=self._headers(),
                json=body,
            )
            data = res.json()
            if res.status_code >= 400:
                raise RuntimeError(data.get("error") or f"decide failed ({res.status_code})")
            return data

    async def guarded(self, request: dict[str, Any], fn):
        """Run fn only if BleedStop returns ALLOW or LIMIT."""
        decision = await self.decide({**request, "mode": "auto"})
        if decision.get("decision") == "DENY":
            return {"ok": False, "decision": decision, "result": None}
        result = await fn(decision)
        return {"ok": True, "decision": decision, "result": result}

    async def reconcile(self, body: dict[str, Any] | None = None) -> dict[str, Any]:
        """Off hot path: compare app ledger vs vendor usage (ghost spend)."""
        async with httpx.AsyncClient(timeout=self.timeout_s) as client:
            res = await client.post(
                f"{self.base_url}/reconcile",
                headers=self._headers(),
                json=body or {},
            )
            data = res.json()
            if res.status_code >= 400:
                raise RuntimeError(data.get("error") or f"reconcile failed ({res.status_code})")
            return data
