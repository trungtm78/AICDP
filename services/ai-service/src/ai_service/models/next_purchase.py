"""Dự đoán khoảng cách tới đơn kế (số ngày). GBDT hồi quy trên log(days)."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import train_test_split

from ..features.loader import FEATURE_COLS
from .base import clean_matrix


class NextPurchaseModel:
    def __init__(self, feature_cols: list[str] | None = None):
        self.feature_cols = feature_cols or FEATURE_COLS
        self.model: HistGradientBoostingRegressor | None = None
        self.metrics: dict[str, float] = {}
        self._median = 30.0

    def fit(self, x_df: pd.DataFrame, y_days: pd.Series) -> "NextPurchaseModel":
        """MAE báo cáo trên HOLDOUT (train/test split) so baseline median; model serve fit toàn tập."""
        mask = y_days.notna() & (y_days > 0)
        x = clean_matrix(x_df, self.feature_cols)[mask.values]
        y = y_days[mask]
        self._median = float(y.median()) if len(y) else 30.0

        def make():
            return HistGradientBoostingRegressor(max_iter=200, learning_rate=0.08, max_depth=4, random_state=42)

        if len(y) >= 40:
            x_tr, x_te, y_tr, y_te = train_test_split(x, y, test_size=0.25, random_state=42)
            ev = make().fit(x_tr, np.log1p(y_tr.to_numpy()))
            pred_te = np.expm1(ev.predict(x_te))
            base_mae = mean_absolute_error(y_te, np.full(len(y_te), float(y_tr.median())))
            self.metrics = {
                "mae": float(mean_absolute_error(y_te, pred_te)), "baseline_mae": float(base_mae),
                "sample_size": int(len(y)), "holdout_size": int(len(y_te)), "eval": "holdout",
            }
            self.model = make().fit(x, np.log1p(y.to_numpy()))  # serve: toàn tập
        elif len(y) >= 20:
            self.model = make().fit(x, np.log1p(y.to_numpy()))
            pred = np.expm1(self.model.predict(x))
            self.metrics = {
                "mae": float(mean_absolute_error(y, pred)),
                "baseline_mae": float(mean_absolute_error(y, np.full(len(y), self._median))),
                "sample_size": int(len(y)), "eval": "in_sample",
            }
        else:
            self.model = None
            self.metrics = {"mae": 0.0, "baseline_mae": 0.0, "sample_size": int(len(y)), "eval": "insufficient"}
        return self

    def predict_days(self, x_df: pd.DataFrame) -> np.ndarray:
        x = clean_matrix(x_df, self.feature_cols)
        if self.model is None:
            return np.full(len(x), self._median)
        return np.clip(np.expm1(self.model.predict(x)), 1, 3650)
