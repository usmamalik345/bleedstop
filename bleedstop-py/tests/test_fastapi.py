import httpx
import respx
from fastapi.testclient import TestClient

from bleedstop import BleedStopClient
from examples.app import MockLLM, create_app

BASE = "http://bs.test"


def make():
    llm = MockLLM()
    app = create_app(BleedStopClient(BASE), llm)
    return TestClient(app), llm


@respx.mock
def test_allow_calls_llm():
    respx.post(f"{BASE}/decide").mock(return_value=httpx.Response(200, json={"decision": "ALLOW"}))
    c, llm = make()
    r = c.post("/ai/rewrite", json={"actorId": "u1", "text": "hello world"})
    assert r.status_code == 200 and llm.calls == 1


@respx.mock
def test_deny_is_429_and_llm_not_called():
    route = respx.post(f"{BASE}/decide").mock(return_value=httpx.Response(200, json={"decision": "DENY", "reason": "ceiling"}))
    c, llm = make()
    r = c.post("/ai/rewrite", json={"actorId": "u1", "text": "x" * 400_000})
    assert r.status_code == 429 and llm.calls == 0
    sent = route.calls[0].request.read()
    assert b'"estimatedTokens":100512' in sent  # computed server side from the real prompt


@respx.mock
def test_challenge_is_403():
    respx.post(f"{BASE}/decide").mock(return_value=httpx.Response(200, json={"decision": "CHALLENGE"}))
    c, llm = make()
    assert c.post("/ai/rewrite", json={"actorId": "u1", "text": "x"}).status_code == 403
    assert llm.calls == 0


@respx.mock
def test_limit_caps_max_tokens():
    respx.post(f"{BASE}/decide").mock(return_value=httpx.Response(200, json={"decision": "LIMIT", "limit": {"maxTokens": 50}}))
    c, _ = make()
    r = c.post("/ai/rewrite", json={"actorId": "u1", "text": "x", "maxTokens": 4000})
    assert r.json()["output_tokens"] == 50


@respx.mock
def test_outage_llm_degrades_to_local_cap():
    respx.post(f"{BASE}/decide").mock(side_effect=httpx.ConnectError("down"))
    c, _ = make()
    r = c.post("/ai/rewrite", json={"actorId": "u1", "text": "x", "maxTokens": 4000})
    assert r.status_code == 200 and r.json()["degraded"] is True and r.json()["output_tokens"] == 200
