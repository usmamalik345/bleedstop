"""
Pytest suite — FastAPI Depends guard + BleedStop client (mocked).

  npm run test:py
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient

import deps as deps_mod
import main as app_module
from bleedstop_client import BleedStopClient
from main import app


@pytest.fixture(autouse=True)
def _sync_clients(monkeypatch):
    """Keep Depends client and main.bleedstop the same mockable object."""
    deps_mod.client = app_module.bleedstop
    yield


@pytest.mark.asyncio
async def test_health():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert "Depends" in data.get("guard", "")


@pytest.mark.asyncio
async def test_payment_allow(monkeypatch):
    monkeypatch.setattr(
        app_module.bleedstop,
        "decide",
        AsyncMock(
            return_value={
                "decision": "ALLOW",
                "clusterId": "C-test",
                "action": "payment.attempt",
                "ceilingUsd": 5,
            }
        ),
    )
    deps_mod.client = app_module.bleedstop

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/payments/attempt",
            json={
                "actorId": "u1",
                "email": "a@b.com",
                "deviceFingerprint": "fp1",
                "paid": False,
            },
        )
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert data["bleedstop"]["decision"] == "ALLOW"


@pytest.mark.asyncio
async def test_payment_deny(monkeypatch):
    monkeypatch.setattr(
        app_module.bleedstop,
        "decide",
        AsyncMock(
            return_value={
                "decision": "DENY",
                "reason": "Unpaid cluster would exceed $5",
            }
        ),
    )
    deps_mod.client = app_module.bleedstop

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/payments/attempt",
            json={"actorId": "u1", "deviceFingerprint": "fp1", "paid": False},
        )
    assert res.status_code == 429
    data = res.json()
    assert data["code"] == "BLEEDSTOP_DENY"
    assert data["decision"]["decision"] == "DENY"


@pytest.mark.asyncio
async def test_client_guarded_deny():
    client = BleedStopClient(base_url="http://example.invalid")
    client.decide = AsyncMock(return_value={"decision": "DENY", "reason": "ceiling"})

    async def boom(_d):
        raise AssertionError("fn must not run on DENY")

    out = await client.guarded({"actorId": "x", "action": "sms.send"}, boom)
    assert out["ok"] is False
    assert out["result"] is None


@pytest.mark.asyncio
async def test_client_guarded_allow():
    client = BleedStopClient(base_url="http://example.invalid")
    client.decide = AsyncMock(return_value={"decision": "ALLOW", "clusterId": "C-1"})

    async def work(decision):
        return {"done": True, "cluster": decision["clusterId"]}

    out = await client.guarded({"actorId": "x", "action": "sms.send"}, work)
    assert out["ok"] is True
    assert out["result"]["done"] is True


@pytest.mark.asyncio
async def test_client_reconcile_posts():
    client = BleedStopClient(base_url="http://example.invalid", api_key="k")

    class FakeResp:
        status_code = 200

        def json(self):
            return {
                "results": [
                    {"keyId": "gm-demo-key", "ghostDetected": True, "ghostSpend": 25}
                ]
            }

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, headers=None, json=None):
            assert url.endswith("/reconcile")
            assert headers.get("X-API-Key") == "k"
            return FakeResp()

    import bleedstop_client as bc

    original = bc.httpx.AsyncClient
    bc.httpx.AsyncClient = FakeAsyncClient
    try:
        report = await client.reconcile({})
        assert report["results"][0]["ghostDetected"] is True
    finally:
        bc.httpx.AsyncClient = original
