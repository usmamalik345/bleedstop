"""
Protected SaaS sample — FastAPI + BleedStop.

Portfolio proof: same money-guard pattern as Express, but in Python.
Uses FastAPI Depends (`require_bleedstop`) like Express middleware.

  Terminal 1:  npm start                 # BleedStop :3000
  Terminal 2:  npm run app:py            # FastAPI   :5000
"""

from __future__ import annotations

import os
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import deps as deps_mod
from bleedstop_client import BleedStopClient
from deps import require_bleedstop

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

app = FastAPI(
    title="Protected SaaS (FastAPI)",
    description="Paid routes ask BleedStop via Depends — Python portfolio sample.",
    version="0.2.0",
)

bleedstop = BleedStopClient()
deps_mod.client = bleedstop  # Depends uses same client (tests can swap)

VENDOR_SMS = "tw-demo-key"
VENDOR_LLM = os.getenv("BLEEDSTOP_VENDOR_KEY_ID", "oa-live-key")
VENDOR_STRIPE = os.getenv("BLEEDSTOP_STRIPE_VENDOR_KEY", "stripe-live-key")


class OtpBody(BaseModel):
    actorId: str | None = None
    email: str | None = None
    deviceFingerprint: str | None = None
    phone: str | None = None
    phoneCountry: str | None = None
    ipCountry: str | None = None
    paid: bool = False


class AiBody(BaseModel):
    actorId: str | None = None
    email: str | None = None
    deviceFingerprint: str | None = None
    text: str = "Improve this resume bullet."
    paid: bool = False


class PayBody(BaseModel):
    actorId: str | None = None
    email: str | None = None
    deviceFingerprint: str | None = None
    amountCents: int = Field(default=500, ge=50, le=50000)
    paid: bool = False


@app.get("/health")
async def health():
    return {
        "ok": True,
        "app": "Protected SaaS (FastAPI)",
        "bleedstop": bleedstop.base_url,
        "stack": "python-fastapi",
        "guard": "Depends(require_bleedstop)",
    }


@app.get("/")
async def root():
    return {
        "name": "Protected SaaS sample (FastAPI + BleedStop)",
        "endpoints": {
            "POST /auth/otp": "sms.send via Depends",
            "POST /ai/rewrite": "llm.call via Depends",
            "POST /payments/attempt": "payment.attempt via Depends",
            "GET /health": "status",
        },
        "note": "Control plane stays Node; this app proves Python Depends integration.",
    }


@app.post("/auth/otp")
async def auth_otp(
    body: OtpBody,
    decision: dict[str, Any] = require_bleedstop("sms.send", VENDOR_SMS),
):
    return {
        "ok": True,
        "otpQueued": True,
        "phone": body.phone or "redacted",
        "provider": "twilio-or-mock",
        "bleedstop": decision,
    }


@app.post("/ai/rewrite")
async def ai_rewrite(
    body: AiBody,
    decision: dict[str, Any] = require_bleedstop("llm.call", VENDOR_LLM),
):
    action = decision.get("action") or "llm.call"
    return {
        "ok": True,
        "mode": "offline-stub",
        "rewritten": f"[fastapi stub:{action}] {body.text[:120]}",
        "bleedstop": decision,
    }


@app.post("/payments/attempt")
async def payments_attempt(
    body: PayBody,
    decision: dict[str, Any] = require_bleedstop("payment.attempt", VENDOR_STRIPE),
):
    return {
        "ok": True,
        "mode": "fastapi-guarded",
        "amountCents": body.amountCents,
        "message": "BleedStop ALLOW/LIMIT via Depends — Stripe lives on Express checkout sample.",
        "decisionAction": decision.get("action"),
        "ceilingUsd": decision.get("ceilingUsd"),
        "bleedstop": decision,
    }


@app.exception_handler(HTTPException)
async def http_exc_handler(_request: Request, exc: HTTPException):
    if isinstance(exc.detail, dict):
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"error": str(exc.detail)})
