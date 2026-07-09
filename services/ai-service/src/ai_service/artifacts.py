"""Lưu/nạp bundle model (joblib) tại MODELS_DIR. Một bundle chứa cả 4 model + metadata."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import cloudpickle  # xử lý được closure/lambda (lifetimes BG/NBD) mà joblib/pickle không pickle được

from .config import settings

BUNDLE_NAME = "bundle.pkl"


def _dir() -> Path:
    p = Path(settings.models_dir)
    p.mkdir(parents=True, exist_ok=True)
    return p


def save_bundle(bundle: dict[str, Any]) -> str:
    path = _dir() / BUNDLE_NAME
    with open(path, "wb") as f:
        cloudpickle.dump(bundle, f)
    return str(path)


def load_bundle() -> dict[str, Any] | None:
    path = _dir() / BUNDLE_NAME
    if not path.exists():
        return None
    try:
        with open(path, "rb") as f:
            return cloudpickle.load(f)
    except Exception:  # noqa: BLE001
        return None


def bundle_exists() -> bool:
    return (_dir() / BUNDLE_NAME).exists()
