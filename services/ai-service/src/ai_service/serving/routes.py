"""FastAPI routes cho ai-service."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import artifacts
from ..db import query_df
from ..registry import version_map
from ..training.pipeline import train_all
from . import scorer
from .schemas import LookalikeRequest, ScoreBatchRequest

router = APIRouter(prefix="/v1")


@router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "hasModels": artifacts.bundle_exists(),
        "activeModels": version_map(),
    }


@router.get("/models")
def models() -> dict:
    df = query_df(
        """SELECT model_type, version, algorithm, metrics, sample_size, is_active, trained_at
             FROM cdp.ml_model ORDER BY model_type, version DESC"""
    )
    return {"models": df.to_dict(orient="records")}


@router.get("/score/{occ_id}")
def score_one(occ_id: str) -> dict:
    res = scorer.score([occ_id])
    if not res:
        raise HTTPException(status_code=404, detail="no_model_or_customer")
    return res[0]


@router.post("/score/batch")
def score_batch(req: ScoreBatchRequest) -> dict:
    return {"predictions": scorer.score(req.occIds)}


@router.post("/lookalike")
def lookalike(req: LookalikeRequest) -> dict:
    return {"results": scorer.lookalike(req.seedOccIds, req.limit)}


@router.post("/train")
def train() -> dict:
    result = train_all()
    scorer.reload_bundle()
    return result
