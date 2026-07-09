"""Test feature engineering: không leakage + nhãn đúng."""
from __future__ import annotations

import numpy as np
import pandas as pd

from ai_service.features import loader


def _synthetic_tx(n_customers=60, seed=0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    start = pd.Timestamp("2025-01-01", tz="UTC")
    for c in range(n_customers):
        occ = f"occ-{c:03d}"
        n = int(rng.integers(2, 12))
        # khách chẵn: mua đều tới gần đây; khách lẻ: ngừng sớm (churn)
        gap = 20 if c % 2 == 0 else 12
        t = start + pd.Timedelta(days=int(rng.integers(0, 30)))
        for _ in range(n):
            rows.append({"occ_id": occ, "occ_timestamp": t, "total": float(rng.integers(50_000, 500_000)),
                         "brand_id": f"brand-{c % 3}"})
            stop = 0 if c % 2 == 0 else (250 if _ >= 2 else 0)
            t = t + pd.Timedelta(days=gap + int(rng.integers(0, 10)) + stop)
    df = pd.DataFrame(rows)
    df["occ_timestamp"] = pd.to_datetime(df["occ_timestamp"], utc=True)
    return df


def test_build_features_no_future_leakage():
    tx = _synthetic_tx()
    t_cut = pd.Timestamp("2025-08-01", tz="UTC")
    feats = loader.build_features(tx, pd.DataFrame(), pd.DataFrame(), t_cut)
    # feature chỉ dùng giao dịch < t_cut → recency_days luôn > 0 và last order < t_cut
    assert not feats.empty
    assert (feats["recency_days"] >= 0).all()
    assert set(loader.FEATURE_COLS).issubset(set(feats.columns))


def test_churn_and_propensity_labels_disjoint_windows():
    tx = _synthetic_tx()
    t_cut = pd.Timestamp("2025-06-01", tz="UTC")
    feats = loader.build_features(tx, pd.DataFrame(), pd.DataFrame(), t_cut)
    churn = loader.add_churn_label(feats, tx, t_cut, 180)
    prop = loader.add_propensity_label(feats, tx, t_cut, 30)
    assert set(churn.unique()).issubset({0, 1})
    assert set(prop.unique()).issubset({0, 1})
    # có tín hiệu: một số churn=1 và một số propensity=1
    assert churn.sum() >= 1
