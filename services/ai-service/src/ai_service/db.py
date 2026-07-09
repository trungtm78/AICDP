"""Kết nối Postgres (psycopg3) + helper đọc DataFrame."""
from __future__ import annotations

import pandas as pd
import psycopg
from psycopg_pool import ConnectionPool

from .config import settings

_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(settings.dsn, min_size=1, max_size=5, open=True)
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def query_df(sql: str, params: tuple | None = None) -> pd.DataFrame:
    """Đọc SELECT -> pandas DataFrame (đóng connection về pool)."""
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            cols = [d.name for d in cur.description] if cur.description else []
            rows = cur.fetchall()
    return pd.DataFrame(rows, columns=cols)


def execute(sql: str, params: tuple | None = None) -> None:
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()


def executemany(sql: str, seq: list[tuple]) -> None:
    if not seq:
        return
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.executemany(sql, seq)
        conn.commit()


__all__ = ["get_pool", "close_pool", "query_df", "execute", "executemany", "psycopg"]
