"""
Regex agent guard vs trained classifier (protectai/deberta-v3-base-prompt-injection-v2) vs two stage.
Local CPU benchmark. Positive = "block" (regex) / score >= 0.5 (classifier) / either (two stage).
  python classifier/benchmark.py --out results/classifier-benchmark.json --md results/CLASSIFIER-REPORT.md
"""
import argparse, glob, json, os, subprocess, sys, time, statistics
import pandas as pd, yaml, torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification

ap = argparse.ArgumentParser()
ap.add_argument("--out"); ap.add_argument("--md"); ap.add_argument("--pint", default=os.environ.get("PINT_EXAMPLE", "/workspace/clf/pint-example.yaml"))
a = ap.parse_args()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL = "protectai/deberta-v3-base-prompt-injection-v2"
torch.set_num_threads(int(os.environ.get("CLASSIFIER_THREADS", "4")))
tok = AutoTokenizer.from_pretrained(MODEL); model = AutoModelForSequenceClassification.from_pretrained(MODEL).eval()
INJ = next(i for i, l in model.config.id2label.items() if l.upper() == "INJECTION")

def snap(name):
    return glob.glob(os.path.expanduser(f"~/.cache/huggingface/hub/datasets--{name}/snapshots/*/data"))[0]
d = snap("deepset--prompt-injections")
deep_train = pd.read_parquet(glob.glob(d + "/train-*.parquet")[0]); deep_test = pd.read_parquet(glob.glob(d + "/test-*.parquet")[0])
def jl(p): return [json.loads(l) for l in open(os.path.join(ROOT, p)) if l.strip()]
sets = {
  "deepset/prompt-injections (all 662)": [(r.text, int(r.label)) for r in pd.concat([deep_train, deep_test]).itertuples()],
  "deepset/prompt-injections (test split 116)": [(r.text, int(r.label)) for r in deep_test.itertuples()],
  "BleedStop dev set (regex tuned on it)": [(r["text"], int(r["label"] == "injection")) for r in jl("evals/agent/injection-v1.jsonl")],
  "BleedStop held-out set": [(r["text"], int(r["label"] == "injection")) for r in jl("evals/agent/injection-test-v1.jsonl")],
}
if os.path.exists(a.pint):
    sets["PINT example file (8 rows, NOT the PINT benchmark)"] = [(r["text"], int(bool(r["label"]))) for r in yaml.safe_load(open(a.pint))]

def regex(texts):
    p = subprocess.run(["node", os.path.join(ROOT, "classifier/regex_verdicts.mjs")], input="\n".join(json.dumps({"text": t}) for t in texts) + "\n", capture_output=True, text=True, cwd=ROOT, check=True)
    return [json.loads(l) for l in p.stdout.strip().split("\n")]

def clf(texts):
    out = []
    with torch.inference_mode():
        for t in texts:  # one at a time = per request latency, as the sidecar sees it
            t0 = time.perf_counter()
            enc = tok([t], truncation=True, max_length=512, return_tensors="pt")
            p = float(torch.softmax(model(**enc).logits, -1)[0, INJ])
            out.append((p, (time.perf_counter() - t0) * 1000))
    return out

def m(pred, y):
    tp = sum(1 for p, t in zip(pred, y) if p and t); fp = sum(1 for p, t in zip(pred, y) if p and not t)
    fn = sum(1 for p, t in zip(pred, y) if not p and t); tn = sum(1 for p, t in zip(pred, y) if not p and not t)
    r = lambda x: round(x * 100, 1)
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn, "precision": r(tp / (tp + fp)) if tp + fp else None, "recall": r(tp / (tp + fn)) if tp + fn else None, "fpr": r(fp / (fp + tn)) if fp + tn else None}
def q(xs, p): s = sorted(xs); return round(s[min(len(s) - 1, int(p * len(s)))], 3)

res = {"model": MODEL, "threads": torch.get_num_threads(), "torch": torch.__version__, "ranAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "sets": {}}
for name, rows in sets.items():
    texts = [t for t, _ in rows]; y = [l for _, l in rows]
    rv = regex(texts); cv = clf(texts)
    rb = [v["verdict"] == "block" for v in rv]; cb = [s >= 0.5 for s, _ in cv]
    res["sets"][name] = {"n": len(rows), "positives": sum(y),
        "regex": {**m(rb, y), "latencyUs": {"p50": q([v["us"] for v in rv], .5), "p99": q([v["us"] for v in rv], .99)}},
        "regexFlagOrBlock": m([v["verdict"] != "allow" for v in rv], y),
        "classifier": {**m(cb, y), "latencyMs": {"p50": q([ms for _, ms in cv], .5), "p95": q([ms for _, ms in cv], .95), "p99": q([ms for _, ms in cv], .99)}},
        "twoStage": m([x or z for x, z in zip(rb, cb)], y)}
    print(name, json.dumps(res["sets"][name]), file=sys.stderr)

if a.out: json.dump(res, open(a.out, "w"), indent=2)
if a.md:
    L = ["# Injection classifier benchmark (local, CPU)", "", f"Model `{MODEL}`, torch {res['torch']}, {res['threads']} CPU threads, run {res['ranAt']}. Regex = BleedStop agent guard `block` verdict. Two stage = regex block OR classifier score >= 0.5.", "",
         "| Set | n | Detector | Precision | Recall | FPR | Latency p50 / p99 |", "|---|---|---|---|---|---|---|"]
    for name, s in res["sets"].items():
        L.append(f"| {name} | {s['n']} | regex | {s['regex']['precision']}% | {s['regex']['recall']}% | {s['regex']['fpr']}% | {s['regex']['latencyUs']['p50']} / {s['regex']['latencyUs']['p99']} us |")
        L.append(f"| | | classifier | {s['classifier']['precision']}% | {s['classifier']['recall']}% | {s['classifier']['fpr']}% | {s['classifier']['latencyMs']['p50']} / {s['classifier']['latencyMs']['p99']} ms |")
        L.append(f"| | | two stage | {s['twoStage']['precision']}% | {s['twoStage']['recall']}% | {s['twoStage']['fpr']}% | |")
    L += ["", "## Caveats", "",
          "* deepset/prompt-injections contains German and other non English rows; the v2 model is documented as English only, which lowers its recall there.",
          "* The protectai v2 model card lists its training sources; overlap with public sets like deepset cannot be ruled out, so treat deepset numbers as optimistic for the classifier.",
          "* The PINT row uses the public 8 row example file shipped in the PINT repo. It is not the gated PINT benchmark and is not a PINT score.",
          "* Llama Prompt Guard 2 is gated on Hugging Face and was not evaluated.",
          "* The regex was tuned on the BleedStop dev set; the held-out set was written after tuning."]
    open(a.md, "w").write("\n".join(L) + "\n")
