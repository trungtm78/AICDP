"""Tiện ích chung cho model: giải thích (explainability) không cần SHAP.

Per-customer reasons = đặc trưng lệch nhiều nhất so với trung bình quần thể, có trọng số bằng
độ quan trọng toàn cục (permutation importance). Đủ minh bạch cho demo, honest-labeled.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

FEATURE_LABEL_VI = {
    "recency_days": "số ngày kể từ đơn gần nhất",
    "frequency": "tần suất mua",
    "monetary": "tổng chi tiêu",
    "avg_basket": "giá trị đơn trung bình",
    "tenure_days": "thời gian gắn bó",
    "ipt_mean": "khoảng cách mua trung bình",
    "ipt_std": "độ dao động chu kỳ mua",
    "spend_slope": "xu hướng chi tiêu",
    "distinct_brands": "số thương hiệu đã mua",
    "distinct_categories": "số nhóm hàng",
    "loyalty_available": "điểm khả dụng",
    "days_since_first": "số ngày từ lần đầu",
}


def top_reasons(
    row: pd.Series,
    means: pd.Series,
    stds: pd.Series,
    importances: dict[str, float],
    k: int = 3,
) -> list[str]:
    """Sinh k lý do: đặc trưng lệch chuẩn hoá lớn nhất × trọng số quan trọng."""
    scores = {}
    for f, w in importances.items():
        if f not in row.index or f not in means.index:
            continue
        sd = stds.get(f, 0.0) or 1.0
        z = (float(row[f]) - float(means[f])) / sd
        scores[f] = abs(z) * (w + 1e-6)
    top = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:k]
    out = []
    for f, _ in top:
        label = FEATURE_LABEL_VI.get(f, f)
        direction = "cao" if float(row[f]) >= float(means[f]) else "thấp"
        out.append(f"{label} {direction}")
    return out


def clean_matrix(df: pd.DataFrame, feature_cols: list[str]) -> pd.DataFrame:
    """Chọn cột feature, ép số, thay NaN/inf bằng 0."""
    x = df.reindex(columns=feature_cols).astype(float)
    return x.replace([np.inf, -np.inf], 0.0).fillna(0.0)
