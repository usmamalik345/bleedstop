"""Typed request/response models mirroring the BleedStop /decide API."""
from __future__ import annotations

from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class Verdict(str, Enum):
    ALLOW = "ALLOW"
    LIMIT = "LIMIT"
    CHALLENGE = "CHALLENGE"
    DENY = "DENY"


class Signals(BaseModel):
    model_config = ConfigDict(extra="forbid")
    deviceFingerprint: Optional[str] = Field(default=None, max_length=256)
    email: Optional[str] = Field(default=None, max_length=256)
    asn: Optional[str] = Field(default=None, max_length=256)
    ip: Optional[str] = Field(default=None, max_length=256)


class AgentContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: Optional[str] = Field(default=None, max_length=200_000)
    toolName: Optional[str] = Field(default=None, max_length=64)
    toolArgs: Optional[Any] = None
    sessionId: Optional[str] = Field(default=None, max_length=128)
    depth: Optional[int] = Field(default=None, ge=0, le=1000)


class DecideRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    actorId: str = Field(min_length=1, max_length=200, pattern=r"^[\w.@:+\-/]+$")
    action: str = Field(min_length=1, max_length=64)
    paid: bool = False
    vendorKeyId: Optional[str] = None
    idempotencyKey: Optional[str] = Field(default=None, max_length=128, pattern=r"^[\w.@:+\-/]+$")
    estimatedTokens: Optional[int] = Field(default=None, ge=0, le=50_000_000)
    phoneCountry: Optional[str] = Field(default=None, pattern=r"^[A-Z]{2}$")
    ipCountry: Optional[str] = Field(default=None, pattern=r"^[A-Z]{2}$")
    signals: Signals = Field(default_factory=Signals)
    agent: Optional[AgentContext] = None
    mode: Literal["auto", "reserve", "commit"] = "auto"


class Limit(BaseModel):
    model_config = ConfigDict(extra="allow")
    action: Optional[str] = None
    maxTokens: Optional[int] = None


class Decision(BaseModel):
    """Server answer. Unknown fields are kept (forward compatible)."""
    model_config = ConfigDict(extra="allow")
    decision: Verdict
    reason: Optional[str] = None
    clusterId: Optional[str] = None
    action: Optional[str] = None
    estimatedCost: Optional[float] = None
    limit: Optional[Limit] = None
    replay: bool = False
    degraded: bool = False
    failPolicy: Optional[str] = None

    @property
    def spend_allowed(self) -> bool:
        return self.decision in (Verdict.ALLOW, Verdict.LIMIT)
