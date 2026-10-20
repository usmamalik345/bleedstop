# CPU only. The 8 bit ONNX file is downloaded on first start from the public
# GitHub Pages URL (see app.py). It is not copied into this image.
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
ENV PORT=8099
EXPOSE 8099
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8099"]
