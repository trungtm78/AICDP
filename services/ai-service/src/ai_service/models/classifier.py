"""Model phân loại dùng chung cho churn & propensity (GBDT + hiệu chỉnh xác suất)."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import train_test_split

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
        """Đo metric trên HOLDOUT (train/test split), KHÔNG in-sample. Model cuối fit trên
        toàn tập để serve; nhưng AUC/Brier báo cáo là out-of-sample (trung thực năng lực)."""
        x = clean_matrix(x_df, self.feature_cols)
        self.means = x.mean()
        self.stds = x.std().replace(0.0, 1.0)
        n_pos = int(y.sum())
        n_neg = int(len(y) - n_pos)

        def make():
            base = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.08, max_depth=4, random_state=42)
            cv = max(2, min(3, n_pos, n_neg))
            return CalibratedClassifierCV(base, method="isotonic", cv=cv)

        # Đủ mẫu + đủ mỗi lớp để tách holdout stratified (cần >=2 dương/âm ở cả train lẫn test).
        if n_pos >= 8 and n_neg >= 8 and len(y) >= 40:
            x_tr, x_te, y_tr, y_te = train_test_split(x, y, test_size=0.25, stratify=y, random_state=42)
            eval_model = make().fit(x_tr, y_tr)
            proba_te = eval_model.predict_proba(x_te)[:, 1]
            self.metrics = {
                "auc": float(roc_auc_score(y_te, proba_te)),
                "brier": float(brier_score_loss(y_te, proba_te)),
                "positives": n_pos,
                "sample_size": int(len(y)),
                "holdout_size": int(len(y_te)),
                "eval": "holdout",
            }
            # Model phục vụ: fit lại trên TOÀN tập (nhiều dữ liệu hơn), metric giữ từ holdout.
            self.model = make().fit(x, y)
            try:
                imp = permutation_importance(eval_model, x_te, y_te, n_repeats=5, random_state=42, scoring="roc_auc")
                self.importances = {c: float(w) for c, w in zip(self.feature_cols, imp.importances_mean)}
            except Exception:
                self.importances = {c: 1.0 for c in self.feature_cols}
        elif n_pos >= 5 and n_neg >= 5 and len(y) >= 30:
            # Ít dữ liệu: fit toàn tập, metric IN-SAMPLE (đánh dấu rõ để honest-label).
            self.model = make().fit(x, y)
            proba = self.model.predict_proba(x)[:, 1]
            self.metrics = {
                "auc": float(roc_auc_score(y, proba)), "brier": float(brier_score_loss(y, proba)),
                "positives": n_pos, "sample_size": int(len(y)), "eval": "in_sample",
            }
            self.importances = {c: 1.0 for c in self.feature_cols}
        else:
            self.model = None  # fallback prior
            self._prior = float(y.mean()) if len(y) else 0.0
            self.importances = {c: 1.0 for c in self.feature_cols}
            self.metrics = {"auc": 0.5, "brier": 0.25, "positives": n_pos, "sample_size": int(len(y)), "eval": "insufficient"}
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
