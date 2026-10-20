"""
BleedStop injection classifier sidecar (second stage after the regex agent guard).
Model: protectai/deberta-v3-base-prompt-injection-v2 (Apache 2.0), CPU inference via transformers.
  pip install -r classifier/requirements.txt
  uvicorn server:app --app-dir classifier --port 8099
POST /classify {"text": "..."} -> {"label": "INJECTION"|"SAFE", "score": p_injection, "ms": inference_ms}
"""
import os, time
from fastapi import FastAPI
from pydantic import BaseModel
import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification

MODEL = os.environ.get("CLASSIFIER_MODEL", "protectai/deberta-v3-base-prompt-injection-v2")
torch.set_num_threads(int(os.environ.get("CLASSIFIER_THREADS", "4")))
tok = AutoTokenizer.from_pretrained(MODEL)
model = AutoModelForSequenceClassification.from_pretrained(MODEL).eval()
INJ = next(i for i, l in model.config.id2label.items() if l.upper() in ("INJECTION", "LABEL_1", "MALICIOUS", "JAILBREAK"))

def score(texts):
    with torch.inference_mode():
        enc = tok(texts, truncation=True, max_length=512, padding=True, return_tensors="pt")
        p = torch.softmax(model(**enc).logits, dim=-1)[:, INJ]
    return [float(x) for x in p]

app = FastAPI(title="bleedstop-classifier")

class Req(BaseModel):
    text: str

@app.get("/health")
def health():
    return {"ok": True, "model": MODEL}

@app.post("/classify")
def classify(r: Req):
    t0 = time.perf_counter()
    p = score([r.text[:20000]])[0]
    return {"label": "INJECTION" if p >= 0.5 else "SAFE", "score": round(p, 6), "ms": round((time.perf_counter() - t0) * 1000, 2), "model": MODEL}
