"""Fail policy when BleedStop is unreachable (mirrors src/failPolicy.js)."""
from __future__ import annotations

from typing import Literal

from .models import Decision, Limit, Verdict

FailMode = Literal["open", "closed", "local_cap"]

FAIL_POLICY: dict[str, FailMode] = {
    "auth.login": "open",
    "signup.create": "open",
    "sms.send": "closed",
    "llm.call": "local_cap",
    "llm.call.small": "local_cap",
    "email.send": "closed",
    "payment.attempt": "closed",
}


def fail_mode_for(action: str) -> FailMode:
    return FAIL_POLICY.get(action, "closed")


def fallback_decision(action: str, detail: str = "") -> Decision:
    mode = fail_mode_for(action)
    if mode == "open":
        return Decision(decision=Verdict.ALLOW, degraded=True, failPolicy=mode,
                        reason=f"BleedStop unavailable; {action} fails open. {detail}".strip())
    if mode == "local_cap":
        return Decision(decision=Verdict.LIMIT, degraded=True, failPolicy=mode, action="llm.call.small",
                        limit=Limit(action="llm.call.small", maxTokens=200),
                        reason=f"BleedStop unavailable; LLM capped locally. {detail}".strip())
    return Decision(decision=Verdict.DENY, degraded=True, failPolicy=mode,
                    reason=f"BleedStop unavailable; {action} fails closed. {detail}".strip())
