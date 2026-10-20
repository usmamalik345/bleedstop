# In browser injection classifier (demo page)

The live demo can run `protectai/deberta-v3-base-prompt-injection-v2` **in the visitor's browser** with onnxruntime-web (WASM, CPU). It loads only when the visitor clicks "Load classifier" or the "Subtle injection" button. **Server side enforcement on the live demo is still the regex guard only.** The browser verdict is shown next to the server verdict and does not change what the server enforces.

## Model build (scripts/build-browser-model.py)

* Source: the official fp32 ONNX export in the protectai repo (`onnx/model.onnx`, 738,563,188 bytes). That is too heavy for a browser.
* Plain dynamic int8 quantization (onnxruntime `quantize_dynamic`, 244 MB) **broke the model**: held out recall fell from 77.5% to 2.5%. Per channel and partial variants also lost 25 to 40 points of label agreement.
* Shipped build: weight only 8 bit `MatMulNBits` (block 32, symmetric, activations stay fp32) plus uint8 word embeddings. **256,175,401 bytes** (256 MB), split into 6 parts under 50 MB and served from GitHub Pages (`docs/models/deberta-pi-v2-q8/`). The tokenizer is 8.7 MB, and the onnxruntime-web WASM plus JS is about 3.1 MB from jsDelivr.
* No smaller credible model was found. The public distilbert ONNX alternative (`protectai/fmops-distilbert-prompt-injection-onnx`) had a 65% false positive rate on the BleedStop held out set.

## Fidelity of the 8 bit build vs the fp32 ONNX (Python onnxruntime, threshold 0.5)

| Set | fp32 recall / FPR | 8 bit recall / FPR | Label agreement | Max score difference |
|---|---|---|---|---|
| BleedStop held out (80) | 77.5% / 5.0% | 77.5% / 5.0% | 100% | 0.062 |
| BleedStop dev (112) | 83.6% / 7.0% | 83.6% / 7.0% | 100% | 0.141 |
| deepset test split (116) | 36.7% / 0.0% | 36.7% / 0.0% | 100% | 0.208 |

The browser scores on the 20 benchmark inputs matched the Python run of the same 8 bit file to 4 decimals. The tokenizers.js token ids matched the Python tokenizer on the inputs checked.

## In browser latency (headless Chromium, warm)

Method: Playwright drives Google Chrome headless. It loads the page, clicks "Subtle injection" (which downloads and initialises the model), runs 3 warm up calls, then times `session.run` on 20 held out inputs (every 4th row, median 15 tokens). The page is not cross origin isolated, so WASM runs **single threaded**. Timing covers inference only, not tokenization.

| Run | Model download + init | Inference p50 | p90 | max |
|---|---|---|---|---|
| Local (model served from localhost) | 2.9 s | 244.8 ms | 274.4 ms | 286.2 ms |
| LIVE (bleedstop-demo.vercel.app, model from GitHub Pages) | LIVE_LOAD | LIVE_P50 | LIVE_P90 | LIVE_MAX |

These are box measurements (8 hardware threads, used single threaded). A visitor's laptop or phone will differ, and a first visit downloads 256 MB.
