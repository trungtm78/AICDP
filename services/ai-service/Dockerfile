# ai-service — FastAPI + scikit-learn/lifetimes. Serve điểm dự đoán ML.
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

# Copy pyproject + src rồi cài (build backend cần src/ để find packages)
COPY pyproject.toml ./
COPY src ./src
RUN pip install --upgrade pip && pip install .

# Model artifact lưu ở volume /models
RUN mkdir -p /models && useradd -m app && chown -R app /app /models
USER app
ENV MODELS_DIR=/models AI_SERVICE_PORT=8072

EXPOSE 8072
CMD ["uvicorn", "ai_service.main:app", "--host", "0.0.0.0", "--port", "8072", "--app-dir", "src"]
