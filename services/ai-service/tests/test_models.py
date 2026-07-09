"""Test model học được tín hiệu (AUC > baseline) + next-purchase thắng baseline median."""
from __future__ import annotations

import numpy as np
import pandas as pd

from ai_service.features.loader import FEATURE_COLS
from ai_service.models.classifier import BinaryModel
from ai_service.models.next_purchase import NextPurchaseModel


def _separable(n=200, seed=1):
    rng = np.random.default_rng(seed)
    x = pd.DataFrame({c: rng.normal(0, 1, n) for c in FEATURE_COLS})
    # nhãn phụ thuộc recency_days + frequency (có tín hiệu thật)
    logit = 1.5 * x["recency_days"] - 1.2 * x["frequency"]
    p = 1 / (1 + np.exp(-logit))
    y = pd.Series((rng.random(n) < p).astype(int))
    x.index = [f"occ-{i}" for i in range(n)]
    y.index = x.index
    return x, y


def test_binary_model_learns_signal():
    x, y = _separable()
    m = BinaryModel().fit(x, y)
    assert m.metrics["auc"] > 0.7  # học được tín hiệu rõ
    proba = m.predict_proba(x)
    assert proba.min() >= 0.0 and proba.max() <= 1.0  # là xác suất
    reasons = m.reasons_for(x.head(3))
    assert all(len(v) >= 1 for v in reasons.values())


def test_binary_model_deterministic():
    x, y = _separable()
    a = BinaryModel().fit(x, y).predict_proba(x)
    b = BinaryModel().fit(x, y).predict_proba(x)
    assert np.allclose(a, b)


def test_next_purchase_beats_baseline():
    rng = np.random.default_rng(2)
    n = 200
    x = pd.DataFrame({c: rng.normal(0, 1, n) for c in FEATURE_COLS})
    # target phụ thuộc ipt_mean (khoảng cách mua) → model học được
    y = pd.Series(np.clip(20 + 8 * x["ipt_mean"] + rng.normal(0, 2, n), 1, None))
    x.index = [f"occ-{i}" for i in range(n)]
    y.index = x.index
    m = NextPurchaseModel().fit(x, y)
    assert m.metrics["mae"] <= m.metrics["baseline_mae"] + 1e-6  # không tệ hơn baseline
