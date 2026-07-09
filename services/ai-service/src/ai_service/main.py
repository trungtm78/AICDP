"""FastAPI app cho OCH-CDP ai-service."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from .db import close_pool, get_pool
from .serving import scorer
from .serving.routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_pool()          # mở pool
    scorer._load()      # warmup bundle nếu có
    yield
    close_pool()


app = FastAPI(title="OCH-CDP ai-service", version="0.1.0", lifespan=lifespan)
app.include_router(router)


@app.get("/")
def root() -> dict:
    return {"service": "occ-cdp-ai-service", "docs": "/docs", "health": "/v1/health"}
