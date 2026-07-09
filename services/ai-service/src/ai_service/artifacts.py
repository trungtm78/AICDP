"""Lưu/nạp bundle model (joblib) tại MODELS_DIR. Một bundle chứa cả 4 model + metadata."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import joblib

from .config import settings

BUNDLE_NAME = "bundle.joblib"


def _dir() -> Path:
    p = Path(settings.models_dir)
    p.mkdir(parents=True, exist_ok=True)
    return p


def save_bundle(bundle: dict[str, Any]) -> str:
    path = _dir() / BUNDLE_NAME
    joblib.dump(bundle, path)
    return str(path)


def load_bundle() -> dict[str, Any] | None:
    path = _dir() / BUNDLE_NAME
    if not path.exists():
        return None
    try:
        return joblib.load(path)
    except Exception:  # noqa: BLE001
        return None


def bundle_exists() -> bool:
    return (_dir() / BUNDLE_NAME).exists()
