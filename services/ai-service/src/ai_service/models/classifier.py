"""Model phân loại dùng chung cho churn & propensity (GBDT + hiệu chỉnh xác suất)."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import brier_score_loss, roc_auc_score

from ..features.loader import FEATURE_COLS
from .base import clean_matrix, top_reasons


class BinaryModel:
    """GBDT nhị phân + CalibratedClassifierCV (isotonic) để output là xác suất thật."""

    def __init__(self, feature_cols: list[str] | None = None):
        self.feature_cols = feature_cols or FEATURE_COLS
        self.model: CalibratedClassifierCV | None = None
        self.importances: dict[str, float] = {}
        self.means: pd.Series | None = None
        self.stds: pd.Series | None = None
        self.metrics: dict[str, float] = {}

    def fit(self, x_df: pd.DataFrame, y: pd.Series) -> "BinaryModel":
        x = clean_matrix(x_df, self.feature_cols)
        self.means = x.mean()
        self.stds = x.std().replace(0.0, 1.0)
        n_pos = int(y.sum())
        n_neg = int(len(y) - n_pos)
        base = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.08, max_depth=4, random_state=42)
        # Cần cả 2 lớp + đủ mẫu để hiệu chỉnh; nếu quá ít thì fit thô.
        if n_pos >= 5 and n_neg >= 5 and len(y) >= 30:
            cv = min(3, n_pos, n_neg)
            self.model = CalibratedClassifierCV(base, method="isotonic", cv=cv)
            self.model.fit(x, y)
            # importance từ permutation trên toàn tập (demo-grade)
            try:
                imp = permutation_importance(self.model, x, y, n_repeats=5, random_state=42, scoring="roc_auc")
                self.importances = {c: float(w) for c, w in zip(self.feature_cols, imp.importances_mean)}
            except Exception:
                self.importances = {c: 1.0 for c in self.feature_cols}
            proba = self.model.predict_proba(x)[:, 1]
            self.metrics = {
                "auc": float(roc_auc_score(y, proba)) if n_pos and n_neg else 0.5,
                "brier": float(brier_score_loss(y, proba)),
                "positives": n_pos,
                "sample_size": int(len(y)),
            }
        else:
            base.fit(x, y) if len(set(y)) > 1 else None
            self.model = None  # đánh dấu fallback prior
            self._prior = float(y.mean()) if len(y) else 0.0
            self.importances = {c: 1.0 for c in self.feature_cols}
            self.metrics = {"auc": 0.5, "brier": 0.25, "positives": n_pos, "sample_size": int(len(y))}
        return self

    def predict_proba(self, x_df: pd.DataFrame) -> np.ndarray:
        x = clean_matrix(x_df, self.feature_cols)
        if self.model is None:
            return np.full(len(x), getattr(self, "_prior", 0.0))
        return self.model.predict_proba(x)[:, 1]

    def reasons_for(self, x_df: pd.DataFrame) -> dict[str, list[str]]:
        x = clean_matrix(x_df, self.feature_cols)
        out = {}
        for occ_id, row in x.iterrows():
            out[occ_id] = top_reasons(row, self.means, self.stds, self.importances)
        return out
