"""Cấu hình ai-service (env). Mặc định trỏ Postgres 18 @127.0.0.1:5433 DB AI_CDP_Pro."""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    # Postgres (chung DB với core-api). Trong Docker prod: PG_HOST=postgres.
    pg_host: str = "127.0.0.1"
    pg_port: int = 5433
    pg_db: str = "AI_CDP_Pro"
    pg_user: str = "occ_cdp"
    pg_password: str = "occ_cdp_dev"

    ai_service_port: int = 8072
    models_dir: str = "./_models"          # nơi lưu joblib artifact
    statement_timeout_ms: int = 8000        # chống giữ lock lâu khi query analytic

    # Ngưỡng promote model active (thắng baseline mới set active)
    min_auc: float = 0.6
    propensity_horizon_days: int = 30
    churn_gap_days: int = 180

    @property
    def dsn(self) -> str:
        return (
            f"host={self.pg_host} port={self.pg_port} dbname={self.pg_db} "
            f"user={self.pg_user} password={self.pg_password} "
            f"options='-c statement_timeout={self.statement_timeout_ms}'"
        )


settings = Settings()
