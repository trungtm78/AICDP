"""Xây feature matrix + nhãn theo time-split (chống leakage).

Nguyên tắc: chọn mốc cắt T_cut. Feature tính TỪ giao dịch trong [start, T_cut) (observation
window). Nhãn tính TỪ giao dịch trong [T_cut, T_cut + horizon) (label window). Serving/score
dùng feature as-of "now" (không nhãn).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

FEATURE_COLS = [
    "recency_days", "frequency", "monetary", "avg_basket", "tenure_days",
    "ipt_mean", "ipt_std", "spend_slope", "distinct_brands", "distinct_categories",
    "loyalty_available", "days_since_first",
]


def load_transactions() -> pd.DataFrame:
    """Tải toàn bộ giao dịch canonical (occ_id, thời gian, tiền, brand) + loyalty available."""
    from ..db import query_df
    tx = query_df(
        """
        SELECT occ_id::text AS occ_id, occ_timestamp, total::float8 AS total,
               brand_id
          FROM cdp.canonical_transaction
         WHERE occ_id IS NOT NULL
        """
    )
    if not tx.empty:
        tx["occ_timestamp"] = pd.to_datetime(tx["occ_timestamp"], utc=True)
    return tx


def load_categories() -> pd.DataFrame:
    """(occ_id, category_id, occ_timestamp) — kèm thời gian để cắt AS-OF (chống leakage)."""
    from ..db import query_df
    df = query_df(
        """
        SELECT e.occ_id::text AS occ_id, e.category_id,
               ct.occ_timestamp
          FROM cdp.v_purchase_enriched e
          JOIN cdp.canonical_transaction ct ON ct.message_id = e.message_id
         WHERE e.occ_id IS NOT NULL AND e.category_id IS NOT NULL
        """
    )
    if not df.empty:
        df["occ_timestamp"] = pd.to_datetime(df["occ_timestamp"], utc=True)
    return df


def load_loyalty() -> pd.DataFrame:
    """Dòng ledger available (occ_id, delta, created_at) — thô để tính số dư AS-OF (chống leakage)."""
    from ..db import query_df
    df = query_df(
        """
        SELECT split_part(account, ':', 2) AS occ_id,
               delta::float8 AS delta, created_at
          FROM cdp.loyalty_entry
         WHERE account LIKE 'member:%:available'
        """
    )
    if not df.empty:
        df["created_at"] = pd.to_datetime(df["created_at"], utc=True)
    return df


def _slope(values: np.ndarray) -> float:
    n = len(values)
    if n < 2:
        return 0.0
    x = np.arange(n, dtype=float)
    xm, ym = x.mean(), values.mean()
    denom = ((x - xm) ** 2).sum()
    if denom == 0:
        return 0.0
    return float(((x - xm) * (values - ym)).sum() / denom)


def build_features(
    tx: pd.DataFrame,
    cats: pd.DataFrame,
    loyalty: pd.DataFrame,
    as_of: pd.Timestamp,
) -> pd.DataFrame:
    """Feature per occ tính từ giao dịch TRƯỚC `as_of`. Trả DataFrame index=occ_id."""
    obs = tx[tx["occ_timestamp"] < as_of]
    rows = []
    # AS-OF: chỉ dùng category/loyalty PHÁT SINH TRƯỚC as_of (chống leakage tương lai vào feature).
    if not cats.empty:
        cat_obs = cats[cats["occ_timestamp"] < as_of]
        cat_by_occ = cat_obs.groupby("occ_id")["category_id"].nunique()
    else:
        cat_by_occ = pd.Series(dtype=int)
    if not loyalty.empty:
        loy_obs = loyalty[loyalty["created_at"] < as_of]
        loy_by_occ = loy_obs.groupby("occ_id")["delta"].sum()
    else:
        loy_by_occ = pd.Series(dtype=float)

    for occ_id, g in obs.groupby("occ_id"):
        g = g.sort_values("occ_timestamp")
        ts = g["occ_timestamp"]
        totals = g["total"].to_numpy()
        freq = len(g)
        monetary = float(totals.sum())
        last = ts.iloc[-1]
        first = ts.iloc[0]
        recency_days = (as_of - last).total_seconds() / 86400.0
        tenure_days = (last - first).total_seconds() / 86400.0
        days_since_first = (as_of - first).total_seconds() / 86400.0
        # inter-purchase time (ngày) giữa các đơn liên tiếp
        if freq >= 2:
            deltas = np.diff(ts.values).astype("timedelta64[s]").astype(float) / 86400.0
            ipt_mean = float(deltas.mean())
            ipt_std = float(deltas.std())
        else:
            ipt_mean = 0.0
            ipt_std = 0.0
        rows.append({
            "occ_id": occ_id,
            "recency_days": recency_days,
            "frequency": freq,
            "monetary": monetary,
            "avg_basket": monetary / freq if freq else 0.0,
            "tenure_days": tenure_days,
            "ipt_mean": ipt_mean,
            "ipt_std": ipt_std,
            "spend_slope": _slope(totals),
            "distinct_brands": int(g["brand_id"].nunique()),
            "distinct_categories": int(cat_by_occ.get(occ_id, 0)),
            "loyalty_available": float(loy_by_occ.get(occ_id, 0.0)),
            "days_since_first": days_since_first,
        })
    df = pd.DataFrame(rows)
    if df.empty:
        df = pd.DataFrame(columns=["occ_id", *FEATURE_COLS])
    return df.set_index("occ_id")


def add_churn_label(feats: pd.DataFrame, tx: pd.DataFrame, as_of: pd.Timestamp, gap_days: int) -> pd.Series:
    """churn=1 nếu KHÔNG có đơn trong [as_of, as_of+gap_days). Chỉ khách 'active as-of'."""
    horizon_end = as_of + pd.Timedelta(days=gap_days)
    fut = tx[(tx["occ_timestamp"] >= as_of) & (tx["occ_timestamp"] < horizon_end)]
    bought = set(fut["occ_id"].unique())
    return pd.Series({occ: (0 if occ in bought else 1) for occ in feats.index}, dtype=int)


def add_propensity_label(feats: pd.DataFrame, tx: pd.DataFrame, as_of: pd.Timestamp, horizon_days: int) -> pd.Series:
    """propensity=1 nếu CÓ đơn trong [as_of, as_of+horizon_days)."""
    horizon_end = as_of + pd.Timedelta(days=horizon_days)
    fut = tx[(tx["occ_timestamp"] >= as_of) & (tx["occ_timestamp"] < horizon_end)]
    bought = set(fut["occ_id"].unique())
    return pd.Series({occ: (1 if occ in bought else 0) for occ in feats.index}, dtype=int)


def add_next_interval_label(feats: pd.DataFrame, tx: pd.DataFrame, as_of: pd.Timestamp) -> pd.Series:
    """Số ngày từ as_of tới đơn đầu tiên SAU as_of (nhãn hồi quy; NaN nếu không mua nữa)."""
    fut = tx[tx["occ_timestamp"] >= as_of].sort_values("occ_timestamp")
    first_after = fut.groupby("occ_id")["occ_timestamp"].min()
    out = {}
    for occ in feats.index:
        if occ in first_after.index:
            out[occ] = (first_after[occ] - as_of).total_seconds() / 86400.0
        else:
            out[occ] = np.nan
    return pd.Series(out, dtype=float)
