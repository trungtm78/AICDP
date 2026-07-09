"""Chấm điểm khi serve: build feature as-of hiện tại + predict; lookalike theo kNN."""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

from .. import artifacts, registry
from ..features import loader
from ..models.base import clean_matrix

_bundle: dict[str, Any] | None = None
_bundle_mtime: float = 0.0


def _load() -> dict[str, Any] | None:
    global _bundle
    if _bundle is None:
        _bundle = artifacts.load_bundle()
    return _bundle


def reload_bundle() -> None:
    global _bundle
    _bundle = artifacts.load_bundle()


def has_models() -> bool:
    return _load() is not None


def _current_features() -> pd.DataFrame:
    tx = loader.load_transactions()
    if tx.empty:
        return pd.DataFrame()
    cats = loader.load_categories()
    loyalty = loader.load_loyalty()
    now = pd.Timestamp.utcnow()
    return loader.build_features(tx, cats, loyalty, now)


def score(occ_ids: list[str] | None = None) -> list[dict]:
    """Trả list điểm dự đoán. occ_ids=None -> chấm toàn bộ khách có giao dịch."""
    bundle = _load()
    if bundle is None:
        return []
    feats = _current_features()
    if feats.empty:
        return []
    if occ_ids:
        feats = feats[feats.index.isin(occ_ids)]
    if feats.empty:
        return []

    churn = bundle["churn"]
    prop = bundle["propensity"]
    npm = bundle["next_purchase"]
    clv = bundle["clv"]
    vmap = registry.version_map()

    churn_p = churn.predict_proba(feats)
    prop_p = prop.predict_proba(feats)
    next_days = npm.predict_days(feats)
    clv_df = clv.predict(list(feats.index))
    churn_reasons = churn.reasons_for(feats)
    prop_reasons = prop.reasons_for(feats)

    now = pd.Timestamp.utcnow()
    out = []
    for i, occ_id in enumerate(feats.index):
        nd = float(next_days[i])
        clv_row = clv_df.loc[occ_id] if occ_id in clv_df.index else None
        out.append({
            "occId": occ_id,
            "churn": {"score": round(float(churn_p[i]), 4), "reasons": churn_reasons.get(occ_id, [])},
            "propensity": {"score": round(float(prop_p[i]), 4), "reasons": prop_reasons.get(occ_id, [])},
            "nextPurchase": {
                "intervalDays": int(round(nd)),
                "predictedAt": (now + pd.Timedelta(days=nd)).isoformat(),
            },
            "clv": {
                "value": int(clv_row["predicted_clv"]) if clv_row is not None and not pd.isna(clv_row["predicted_clv"]) else 0,
                "predictedPurchases": round(float(clv_row["predicted_purchases"]), 2) if clv_row is not None and not pd.isna(clv_row["predicted_purchases"]) else 0.0,
            },
            "modelVersions": vmap,
        })
    return out


def lookalike(seed_occ_ids: list[str], limit: int = 50) -> list[dict]:
    """Tìm khách tương đồng seed theo kNN cosine trên feature chuẩn hoá (loại seed)."""
    feats = _current_features()
    if feats.empty or not seed_occ_ids:
        return []
    x = clean_matrix(feats, loader.FEATURE_COLS)
    scaler = StandardScaler()
    xs = scaler.fit_transform(x)
    xs = np.nan_to_num(xs)
    index = list(feats.index)
    seed_pos = [index.index(s) for s in seed_occ_ids if s in index]
    if not seed_pos:
        return []
    centroid = xs[seed_pos].mean(axis=0, keepdims=True)
    k = min(limit + len(seed_pos), len(index))
    nn = NearestNeighbors(n_neighbors=k, metric="cosine").fit(xs)
    dist, idx = nn.kneighbors(centroid)
    seed_set = set(seed_occ_ids)
    res = []
    for d, i in zip(dist[0], idx[0]):
        occ = index[i]
        if occ in seed_set:
            continue
        res.append({"occId": occ, "similarity": round(1.0 - float(d), 4)})
        if len(res) >= limit:
            break
    return res
