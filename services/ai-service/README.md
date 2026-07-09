# OCH-CDP ai-service (ML thật)

Serve điểm dự đoán ML cho core-api: **churn** (GBDT + hiệu chỉnh xác suất), **CLV** (BG/NBD + Gamma-Gamma), **propensity** (GBDT, horizon 30 ngày), **next-purchase** (GBDT hồi quy), **lookalike** (kNN cosine). core-api gọi qua `AI_SERVICE_URL`; **down/timeout → tự fallback heuristic** (circuit-breaker) nên core-api luôn sống.

## Chạy dev (Docker — khuyến nghị, tránh nghẽn cài pip cục bộ)
```bash
docker compose -f infra/docker-compose.dev.yml up -d --build ai-service
curl http://127.0.0.1:8072/v1/health
```

## Chạy local (nếu đã có Python 3.11+ và cài được deps)
```bash
cd services/ai-service
python -m venv .venv && ./.venv/Scripts/pip install -e ".[dev]"
./.venv/Scripts/uvicorn ai_service.main:app --app-dir src --port 8072
```

## Train model (một lần, hoặc định kỳ)
```bash
# trong container:
docker compose -f infra/docker-compose.dev.yml exec ai-service python -m ai_service.scripts.train_all
# hoặc gọi API:
curl -X POST http://127.0.0.1:8072/v1/train
```
Train đọc `cdp.canonical_transaction` (+feature/loyalty/category), **time-split** T_cut = max − 180 ngày (chống leakage), lưu bundle joblib ở `MODELS_DIR`, đăng ký `cdp.ml_model` + `cdp.model_card` + `cdp.model_feature_importance`. Chỉ nhãn nằm trong dữ liệu mới train được (cần lịch sử ≥ ~6 tháng).

## Endpoint
- `GET  /v1/health` — trạng thái + model active
- `GET  /v1/score/{occId}` · `POST /v1/score/batch {occIds?}` — điểm dự đoán + reasons + modelVersions
- `POST /v1/lookalike {seedOccIds, limit}` — khách tương đồng
- `POST /v1/train` — train lại · `GET /v1/models` — registry

## Test
```bash
./.venv/Scripts/pytest        # test feature (không leakage) + model (AUC>baseline, deterministic)
```

## Kiến trúc
- `features/loader.py` — build feature matrix + nhãn theo observation/label window (chống leakage).
- `models/` — classifier (churn/propensity), clv (lifetimes), next_purchase (regressor), base (explain không cần SHAP: đặc trưng lệch chuẩn × độ quan trọng permutation).
- `training/pipeline.py` — orchestrate train + register + save bundle.
- `serving/` — FastAPI routes + scorer (build feature as-of now → predict).
- `registry.py` / `artifacts.py` — model registry (Postgres) + bundle joblib.

Honest-label: khi ai-service chưa train hoặc down, core-api ghi `score_source='heuristic'`; khi có model, `score_source='ml'` + `model_versions`.
