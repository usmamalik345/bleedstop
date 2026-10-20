"""Local injection classifier.

Loads the 8 bit ONNX build of protectai/deberta-v3-base-prompt-injection-v2
(the same file the browser demo uses) with onnxruntime on CPU.

POST /classify  body {"text": "..."}
returns {"label": "SAFE"|"INJECTION", "score": float, "latency_ms": float}

Fail open vs fail closed is decided by the Node process (BLEEDSTOP_CLASSIFIER_FAILMODE),
not here. This process only scores text.
"""
import hashlib
import os
import time
import urllib.request
from pathlib import Path

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from tokenizers import Tokenizer

BASE = os.environ.get(
    "BLEEDSTOP_MODEL_BASE",
    "https://usmamalik345.github.io/bleedstop/models/deberta-pi-v2-q8/",
)
MODEL_DIR = Path(os.environ.get("BLEEDSTOP_MODEL_DIR", "/tmp/bleedstop-model"))
app = FastAPI()
state = {"session": None, "tok": None, "max_len": 512, "error": None}


class InText(BaseModel):
    text: str = Field(default="", max_length=20000)


def _get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def ensure_model() -> None:
    """Download the public model parts once, check the sha256 from the manifest, then load."""
    if state["session"] is not None:
        return
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    import json

    manifest = json.loads(_get(BASE + "manifest.json"))
    onnx_path = MODEL_DIR / "model.onnx"
    digest = hashlib.sha256()
    if not onnx_path.exists() or onnx_path.stat().st_size != manifest["bytes"]:
        with onnx_path.open("wb") as out:
            for part in manifest["parts"]:
                chunk = _get(BASE + part)
                digest.update(chunk)
                out.write(chunk)
        got = digest.hexdigest()
        if got != manifest["sha256"]:
            onnx_path.unlink(missing_ok=True)
            raise RuntimeError("model sha256 mismatch")
    tok_path = MODEL_DIR / "tokenizer.json"
    if not tok_path.exists():
        tok_path.write_bytes(_get(BASE + "tokenizer.json"))
    state["tok"] = Tokenizer.from_file(str(tok_path))
    state["max_len"] = int(manifest.get("maxLength") or 512)
    # CPU provider only. No GPU package.
    state["session"] = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])


@app.on_event("startup")
def _startup() -> None:
    try:
        ensure_model()
    except Exception as err:
        state["error"] = str(err)[:200]


@app.get("/health")
def health():
    if state["session"] is None:
        raise HTTPException(status_code=503, detail=state["error"] or "loading")
    return {"ok": True}


@app.post("/classify")
def classify(body: InText):
    if state["session"] is None:
        raise HTTPException(status_code=503, detail=state["error"] or "loading")
    ids = state["tok"].encode(body.text or "").ids
    max_len = state["max_len"]
    if len(ids) > max_len:
        ids = ids[: max_len - 1] + [ids[-1]]
    if not ids:
        ids = [0]
    arr = np.array([ids], dtype=np.int64)
    mask = np.ones_like(arr)
    t0 = time.perf_counter()
    logits = state["session"].run(None, {"input_ids": arr, "attention_mask": mask})[0][0]
    latency_ms = (time.perf_counter() - t0) * 1000
    m = float(np.max(logits))
    e = np.exp(logits - m)
    score = float(e[1] / e.sum())
    return {
        "label": "INJECTION" if score >= 0.5 else "SAFE",
        "score": score,
        "latency_ms": round(latency_ms, 3),
    }
