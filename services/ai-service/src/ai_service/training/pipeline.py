"""Orchestrate train 4 model theo time-split, đăng ký registry, lưu bundle."""
from __future__ import annotations

import pandas as pd

from .. import artifacts, registry
from ..config import settings
from ..features import loader
from ..models.classifier import BinaryModel
from ..models.clv import ClvModel
from ..models.next_purchase import NextPurchaseModel


def train_all() -> dict:
    tx = loader.load_transactions()
    if tx.empty:
        return {"trained": False, "reason": "no_transactions"}
    cats = loader.load_categories()
    loyalty = loader.load_loyalty()

    max_ts = tx["occ_timestamp"].max()
    # T_cut lùi đủ để nhãn churn (180d) nằm trong dữ liệu.
    t_cut = max_ts - pd.Timedelta(days=settings.churn_gap_days)
    feats = loader.build_features(tx, cats, loyalty, t_cut)
    result = {"trained": True, "t_cut": t_cut.isoformat(), "customers_train": int(len(feats)), "models": {}}

    if len(feats) < 10:
        # Không đủ dữ liệu để train ML — bỏ, để core-api fallback heuristic.
        return {"trained": False, "reason": "insufficient_history", "customers_train": int(len(feats))}

    # is_demo = True khi metric KHÔNG phải holdout (in-sample/thiếu dữ liệu) HOẶC dưới ngưỡng.
    def demo_flag(m: dict) -> bool:
        return m.get("eval") != "holdout" or m.get("auc", 0.0) < settings.min_auc

    # Churn
    y_churn = loader.add_churn_label(feats, tx, t_cut, settings.churn_gap_days)
    churn = BinaryModel().fit(feats, y_churn)
    registry.register_model(
        "churn", "HistGradientBoosting+Isotonic", churn.metrics, churn.feature_cols,
        churn.metrics.get("sample_size", 0), artifacts.BUNDLE_NAME,
        "auc", churn.metrics.get("auc", 0.5), churn.importances,
        is_demo=demo_flag(churn.metrics), data_through=t_cut,
    )
    result["models"]["churn"] = churn.metrics

    # Propensity
    y_prop = loader.add_propensity_label(feats, tx, t_cut, settings.propensity_horizon_days)
    prop = BinaryModel().fit(feats, y_prop)
    registry.register_model(
        "propensity", "HistGradientBoosting+Isotonic", prop.metrics, prop.feature_cols,
        prop.metrics.get("sample_size", 0), artifacts.BUNDLE_NAME,
        "auc", prop.metrics.get("auc", 0.5), prop.importances,
        is_demo=demo_flag(prop.metrics), data_through=t_cut,
    )
    result["models"]["propensity"] = prop.metrics

    # Next-purchase
    y_next = loader.add_next_interval_label(feats, tx, t_cut)
    npm = NextPurchaseModel().fit(feats, y_next)
    registry.register_model(
        "next_purchase", "HistGradientBoostingRegressor", npm.metrics, npm.feature_cols,
        npm.metrics.get("sample_size", 0), artifacts.BUNDLE_NAME,
        "mae", npm.metrics.get("mae", 0.0), {},
        is_demo=(npm.metrics.get("eval") != "holdout" or npm.metrics.get("mae", 1e9) > npm.metrics.get("baseline_mae", 0.0)),
        data_through=t_cut,
    )
    result["models"]["next_purchase"] = npm.metrics

    # CLV (BG/NBD trên obs < T_cut)
    clv = ClvModel().fit(tx, t_cut)
    registry.register_model(
        "clv", "BG/NBD+GammaGamma", clv.metrics, ["frequency", "recency", "T", "monetary_value"],
        clv.metrics.get("sample_size", 0), artifacts.BUNDLE_NAME,
        "repeat_customers", clv.metrics.get("repeat_customers", 0), {},
        is_demo=bool(clv.metrics.get("fallback")), data_through=t_cut,
    )
    result["models"]["clv"] = clv.metrics

    artifacts.save_bundle({
        "churn": churn, "propensity": prop, "next_purchase": npm, "clv": clv,
        "feature_cols": loader.FEATURE_COLS, "trained_at": pd.Timestamp.utcnow().isoformat(),
        "t_cut": t_cut.isoformat(),
    })
    return result
