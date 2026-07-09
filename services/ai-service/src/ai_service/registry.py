"""Model registry: ghi cdp.ml_model + cdp.model_card + cdp.model_feature_importance."""
from __future__ import annotations

import json

from .db import execute, executemany, query_df


def _next_version(model_type: str) -> int:
    df = query_df("SELECT COALESCE(max(version),0)+1 AS v FROM cdp.ml_model WHERE model_type=%s", (model_type,))
    return int(df.iloc[0]["v"]) if not df.empty else 1


def register_model(
    model_type: str,
    algorithm: str,
    metrics: dict,
    feature_list: list[str],
    sample_size: int,
    artifact_uri: str,
    metric_name: str,
    metric_value: float,
    importances: dict[str, float] | None = None,
    is_demo: bool = False,
    data_through=None,
) -> int:
    """Chèn version mới, đặt active (tắt version cũ), cập nhật model_card + importance."""
    version = _next_version(model_type)
    # tắt active cũ trước (partial unique index chỉ cho 1 active)
    execute("UPDATE cdp.ml_model SET is_active=false WHERE model_type=%s AND is_active", (model_type,))
    execute(
        """INSERT INTO cdp.ml_model
             (model_type, version, algorithm, metrics, feature_list, artifact_uri,
              sample_size, data_through, is_active, created_by)
           VALUES (%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s,%s,true,'ai-service')""",
        (model_type, version, algorithm, json.dumps(metrics), json.dumps(feature_list),
         artifact_uri, sample_size, data_through),
    )
    version_str = f"{model_type}-v{version}"
    execute(
        """INSERT INTO cdp.model_card
             (model_type, model_version, algorithm, metric_name, metric_value, sample_size, is_demo, trained_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s, now())
           ON CONFLICT (model_type) DO UPDATE SET
             model_version=EXCLUDED.model_version, algorithm=EXCLUDED.algorithm,
             metric_name=EXCLUDED.metric_name, metric_value=EXCLUDED.metric_value,
             sample_size=EXCLUDED.sample_size, is_demo=EXCLUDED.is_demo, trained_at=now()""",
        (model_type, version_str, algorithm, metric_name, float(metric_value), sample_size, is_demo),
    )
    if importances:
        execute("DELETE FROM cdp.model_feature_importance WHERE model_type=%s", (model_type,))
        top = sorted(importances.items(), key=lambda kv: abs(kv[1]), reverse=True)[:12]
        executemany(
            "INSERT INTO cdp.model_feature_importance (model_type, feature, weight) VALUES (%s,%s,%s)",
            [(model_type, f, float(w)) for f, w in top],
        )
    return version


def version_map() -> dict[str, str]:
    """{model_type: 'churn-v3'} cho model active hiện tại."""
    df = query_df("SELECT model_type, version FROM cdp.ml_model WHERE is_active")
    return {r["model_type"]: f"{r['model_type']}-v{int(r['version'])}" for _, r in df.iterrows()}
