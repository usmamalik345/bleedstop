"""
FastAPI Depends helpers — clean BleedStop guard (like Express middleware).

Usage:
  @app.post("/otp")
  async def otp(
      body: OtpBody,
      decision: dict = require_bleedstop("sms.send", "tw-demo-key"),
  ):
      ...
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import Depends, HTTPException, Request

from bleedstop_client import BleedStopClient

# Shared client (main.py may replace this for tests)
client = BleedStopClient()


def require_bleedstop(action: str, vendor_key_id: str):
    """
    Dependency factory: ask BleedStop before the route runs.
    Uses request.body() (cached) so PayBody / OtpBody still parse.
    """

    async def _dep(request: Request) -> dict[str, Any]:
        raw = await request.body()
        try:
            body = json.loads(raw.decode("utf-8") or "{}") if raw else {}
        except json.JSONDecodeError:
            body = {}
        if not isinstance(body, dict):
            body = {}

        actor_id = (
            body.get("actorId")
            or request.headers.get("x-actor-id")
            or (request.client.host if request.client else "unknown")
        )

        decision = await client.decide(
            {
                "actorId": actor_id,
                "action": action,
                "paid": bool(body.get("paid")),
                "vendorKeyId": vendor_key_id,
                "phoneCountry": body.get("phoneCountry"),
                "ipCountry": body.get("ipCountry"),
                "signals": {
                    "email": body.get("email"),
                    "deviceFingerprint": body.get("deviceFingerprint")
                    or request.headers.get("x-device-fingerprint"),
                    "asn": body.get("asn"),
                },
            }
        )

        if decision.get("decision") == "DENY":
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "BleedStop denied this paid action",
                    "code": "BLEEDSTOP_DENY",
                    "decision": decision,
                },
            )

        request.state.bleedstop_decision = decision
        return decision

    return Depends(_dep)
