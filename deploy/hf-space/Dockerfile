# Hugging Face Docker Space (CPU basic, free) for the BleedStop injection classifier sidecar.
FROM python:3.11-slim
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH HF_HOME=/home/user/.cache/huggingface CLASSIFIER_THREADS=2
WORKDIR /home/user/app
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt
# bake the model into the image so a cold start does not download it
RUN python -c "from transformers import AutoTokenizer, AutoModelForSequenceClassification as M; n='protectai/deberta-v3-base-prompt-injection-v2'; AutoTokenizer.from_pretrained(n); M.from_pretrained(n)"
COPY --chown=user server.py .
EXPOSE 7860
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "7860"]
