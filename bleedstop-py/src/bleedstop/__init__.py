"""bleedstop-py: async client + FastAPI guard for the BleedStop control plane."""
from .client import BleedStopClient, BleedStopError, Guarded
from .models import AgentContext, DecideRequest, Decision, Limit, Signals, Verdict
from .policy import FAIL_POLICY, fallback_decision, fail_mode_for

__all__ = [
    "BleedStopClient", "BleedStopError", "Guarded", "AgentContext", "DecideRequest", "Decision",
    "Limit", "Signals", "Verdict", "FAIL_POLICY", "fallback_decision", "fail_mode_for",
]
__version__ = "0.1.0"
