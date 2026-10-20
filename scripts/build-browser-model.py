"""
Builds the in browser classifier: protectai/deberta-v3-base-prompt-injection-v2 (ONNX, fp32, 739 MB)
-> weight only 8 bit MatMulNBits (block 32, symmetric, activations stay fp32) + uint8 word embeddings
-> about 256 MB, split into <50 MB parts for GitHub Pages (docs/models/deberta-pi-v2-q8/).
Plain dynamic int8 quantization was tried first and broke the model (held out recall 77.5% -> 2.5%).
  pip install onnx onnxruntime onnx_ir
  python scripts/build-browser-model.py /path/to/model.onnx
"""
import hashlib, json, os, sys, onnx
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer, DefaultWeightOnlyQuantConfig
from onnxruntime.quantization import quantize_dynamic, QuantType
src = sys.argv[1]; out_dir = os.path.join(os.path.dirname(__file__), "..", "docs", "models", "deberta-pi-v2-q8")
cfg = DefaultWeightOnlyQuantConfig(block_size=32, is_symmetric=True, bits=8, op_types_to_quantize=("MatMul",))
q = MatMulNBitsQuantizer(onnx.load(src), bits=8, block_size=32, is_symmetric=True, algo_config=cfg, op_types_to_quantize=("MatMul",))
q.process(); onnx.save(q.model.model, "/tmp/_nb8.onnx")
quantize_dynamic("/tmp/_nb8.onnx", "/tmp/model_q8.onnx", weight_type=QuantType.QUInt8, op_types_to_quantize=["Gather"], nodes_to_quantize=["/deberta/embeddings/word_embeddings/Gather"])
data = open("/tmp/model_q8.onnx", "rb").read(); os.makedirs(out_dir, exist_ok=True)
PART = 45 * 1024 * 1024; parts = []
for i in range(0, len(data), PART):
    name = f"model.part{len(parts)}"; open(os.path.join(out_dir, name), "wb").write(data[i:i + PART]); parts.append(name)
json.dump({"source": "protectai/deberta-v3-base-prompt-injection-v2", "quantization": "MatMulNBits 8 bit block 32 symmetric + uint8 word embeddings",
           "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "parts": parts, "labels": {"0": "SAFE", "1": "INJECTION"}, "maxLength": 512},
          open(os.path.join(out_dir, "manifest.json"), "w"), indent=1)
print(len(data), parts)
