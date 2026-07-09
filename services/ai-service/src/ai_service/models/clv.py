"""CLV / LTV: BG/NBD (số đơn tương lai) + Gamma-Gamma (giá trị đơn). Fallback heuristic an toàn.

Dùng thư viện `lifetimes` — chuẩn vàng cho retail non-contractual. Nếu fit lỗi (dữ liệu ít),
fallback: expected_purchases ~ frequency/tenure * horizon; CLV = expected_purchases * avg_value.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

HORIZON_DAYS = 365


class ClvModel:
    def __init__(self, horizon_days: int = HORIZON_DAYS):
        self.horizon_days = horizon_days
        self.bgf = None
        self.ggf = None
        self.metrics: dict[str, float] = {}
        self._summary: pd.DataFrame | None = None

    def fit(self, tx: pd.DataFrame, as_of: pd.Timestamp) -> "ClvModel":
        obs = tx[tx["occ_timestamp"] < as_of].copy()
        if obs.empty:
            self._summary = pd.DataFrame()
            self.metrics = {"sample_size": 0}
            return self
        obs["date"] = obs["occ_timestamp"].dt.tz_convert("UTC").dt.tz_localize(None)
        try:
            from lifetimes.utils import summary_data_from_transaction_data

            summary = summary_data_from_transaction_data(
                obs, customer_id_col="occ_id", datetime_col="date",
                monetary_value_col="total", observation_period_end=as_of.tz_localize(None), freq="D",
            )
            self._summary = summary
            from lifetimes import BetaGeoFitter, GammaGammaFitter

            self.bgf = BetaGeoFitter(penalizer_coef=0.01)
            self.bgf.fit(summary["frequency"], summary["recency"], summary["T"])
            repeat = summary[summary["frequency"] > 0]
            if len(repeat) >= 5:
                self.ggf = GammaGammaFitter(penalizer_coef=0.01)
                self.ggf.fit(repeat["frequency"], repeat["monetary_value"])
            self.metrics = {"sample_size": int(len(summary)), "repeat_customers": int(len(repeat))}
        except Exception as exc:  # noqa: BLE001 — fallback heuristic khi lifetimes lỗi
            self._summary = None
            self._fallback_from_tx(obs, as_of)
            self.metrics = {"sample_size": int(obs["occ_id"].nunique()), "fallback": 1, "error": str(exc)[:120]}
        return self

    def _fallback_from_tx(self, obs: pd.DataFrame, as_of: pd.Timestamp) -> None:
        rows = {}
        for occ_id, g in obs.groupby("occ_id"):
            g = g.sort_values("occ_timestamp")
            freq = len(g)
            monetary = float(g["total"].sum())
            tenure = max((g["occ_timestamp"].iloc[-1] - g["occ_timestamp"].iloc[0]).total_seconds() / 86400.0, 1.0)
            rate = freq / tenure  # đơn/ngày
            exp_purch = rate * self.horizon_days
            aov = monetary / freq if freq else 0.0
            rows[occ_id] = {"clv": exp_purch * aov, "purchases": exp_purch}
        self._fallback = rows

    def predict(self, occ_ids: list[str]) -> pd.DataFrame:
        """Trả DataFrame index=occ_id: predicted_clv, predicted_purchases."""
        if self._summary is not None and self.bgf is not None:
            summary = self._summary
            idx = [o for o in occ_ids if o in summary.index]
            out = pd.DataFrame(index=idx, columns=["predicted_clv", "predicted_purchases"], dtype=float)
            if not idx:
                return out
            sub = summary.loc[idx]
            t = self.horizon_days
            purch = self.bgf.conditional_expected_number_of_purchases_up_to_time(
                t, sub["frequency"], sub["recency"], sub["T"]
            )
            out["predicted_purchases"] = np.clip(purch.values, 0, None)
            if self.ggf is not None:
                clv = self.ggf.customer_lifetime_value(
                    self.bgf, sub["frequency"], sub["recency"], sub["T"], sub["monetary_value"],
                    time=t // 30, freq="D", discount_rate=0.0,
                )
                out["predicted_clv"] = np.clip(clv.values, 0, None)
            else:
                avg = sub["monetary_value"].replace(0, sub["monetary_value"].mean())
                out["predicted_clv"] = np.clip(out["predicted_purchases"] * avg, 0, None)
            return out
        # fallback
        fb = getattr(self, "_fallback", {})
        rows = {o: {"predicted_clv": fb.get(o, {}).get("clv", 0.0),
                    "predicted_purchases": fb.get(o, {}).get("purchases", 0.0)} for o in occ_ids}
        return pd.DataFrame.from_dict(rows, orient="index")
