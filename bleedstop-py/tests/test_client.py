import asyncio

import httpx
import pytest
import respx

from bleedstop import BleedStopClient, BleedStopError, DecideRequest, Verdict

BASE = "http://bs.test"


def req(**kw):
    return DecideRequest(actorId=kw.pop("actorId", "u1"), action=kw.pop("action", "llm.call"), **kw)


@respx.mock
async def test_allow_runs_fn():
    respx.post(f"{BASE}/decide").mock(return_value=httpx.Response(200, json={"decision": "ALLOW", "clusterId": "C-1"}))
    async with BleedStopClient(BASE) as bs:
        g = await bs.guarded(req(), lambda d: asyncio.sleep(0, result="ran"))
    assert g.ok and g.result == "ran" and g.decision.clusterId == "C-1"


@pytest.mark.parametrize("verdict", ["DENY", "CHALLENGE"])
@respx.mock
async def test_deny_and_challenge_do_not_run_fn(verdict):
    respx.post(f"{BASE}/decide").mock(return_value=httpx.Response(200, json={"decision": verdict}))
    ran = []
    async with BleedStopClient(BASE) as bs:
        g = await bs.guarded(req(), lambda d: asyncio.sleep(0, result=ran.append(1)))
    assert not g.ok and ran == []


@respx.mock
async def test_limit_passes_limit_to_fn():
    respx.post(f"{BASE}/decide").mock(return_value=httpx.Response(200, json={"decision": "LIMIT", "limit": {"maxTokens": 300}}))
    async with BleedStopClient(BASE) as bs:
        g = await bs.guarded(req(), lambda d: asyncio.sleep(0, result=d.limit.maxTokens))
    assert g.ok and g.result == 300 and g.decision.decision is Verdict.LIMIT


@respx.mock
async def test_idempotent_parallel_retries_run_fn_once():
    route = respx.post(f"{BASE}/decide").mock(return_value=httpx.Response(200, json={"decision": "ALLOW"}))
    runs = 0

    async def fn(_d):
        nonlocal runs
        runs += 1
        await asyncio.sleep(0.01)
        return runs

    async with BleedStopClient(BASE) as bs:
        outs = await asyncio.gather(*[bs.guarded(req(idempotencyKey="job-1"), fn) for _ in range(50)])
    assert runs == 1 and route.call_count == 1
    assert all(o.result == 1 for o in outs)
    assert sum(o.replay for o in outs) == 49


@respx.mock
async def test_denied_key_can_retry_later():
    route = respx.post(f"{BASE}/decide")
    route.side_effect = [httpx.Response(200, json={"decision": "DENY"}), httpx.Response(200, json={"decision": "ALLOW"})]
    async with BleedStopClient(BASE) as bs:
        a = await bs.guarded(req(idempotencyKey="k"), lambda d: asyncio.sleep(0, result=1))
        b = await bs.guarded(req(idempotencyKey="k"), lambda d: asyncio.sleep(0, result=2))
    assert not a.ok and b.ok and b.result == 2


@pytest.mark.parametrize("action,expected,ok", [
    ("llm.call", Verdict.LIMIT, True),      # local_cap
    ("sms.send", Verdict.DENY, False),      # closed
    ("auth.login", Verdict.ALLOW, True),    # open
])
@respx.mock
async def test_fail_policy_on_outage(action, expected, ok):
    respx.post(f"{BASE}/decide").mock(side_effect=httpx.ConnectError("down"))
    async with BleedStopClient(BASE) as bs:
        g = await bs.guarded(req(action=action), lambda d: asyncio.sleep(0, result="x"))
    assert g.decision.decision is expected and g.decision.degraded and g.ok is ok


@respx.mock
async def test_5xx_uses_fail_policy_and_4xx_raises():
    respx.post(f"{BASE}/decide").mock(side_effect=[httpx.Response(503), httpx.Response(400, json={"error": "invalid"})])
    async with BleedStopClient(BASE) as bs:
        d = await bs.decide(req(action="sms.send"))
        assert d.decision is Verdict.DENY and d.degraded
        with pytest.raises(BleedStopError):
            await bs.decide(req())


def test_model_validation_rejects_bad_input():
    with pytest.raises(Exception):
        DecideRequest(actorId="bad id <script>", action="llm.call")
    with pytest.raises(Exception):
        DecideRequest(actorId="ok", action="llm.call", estimatedTokens=-1)
    with pytest.raises(Exception):
        DecideRequest(actorId="ok", action="llm.call", signals={"evil": "x"})
