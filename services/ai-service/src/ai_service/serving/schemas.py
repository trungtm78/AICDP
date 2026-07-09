"""Pydantic request/response cho serving API."""
from __future__ import annotations

from pydantic import BaseModel


class ScoreBatchRequest(BaseModel):
    occIds: list[str] | None = None


class LookalikeRequest(BaseModel):
    seedOccIds: list[str]
    limit: int = 50


class TrainRequest(BaseModel):
    pass
