from __future__ import annotations

import logging
import logging.config
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from config import settings
from db import engine
from routers import analytics, conversation, github_router, puzzle
from routers import sessions

# ---------------------------------------------------------------------------
# Logging setup — must be first, before any other imports that log
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan (startup / shutdown)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: verify database connectivity
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:
        logger.error(
            "Database connectivity check failed on startup: %s", type(exc).__name__
        )
        raise RuntimeError("Database connection failed — check DATABASE_URL configuration.") from exc

    yield

    # Shutdown: dispose the engine connection pool
    await engine.dispose()


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------

app = FastAPI(
    title="DevCoach API",
    description=(
        "AI-powered developer coaching backend. "
        "Integrates with GitHub to surface prioritised work items and deliver "
        "contextual coaching via Claude Haiku."
    ),
    version="1.0.0",
    docs_url="/docs" if not settings.is_production else None,
    redoc_url="/redoc" if not settings.is_production else None,
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Global exception handler — no stack traces or PII to clients
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # Log full traceback server-side without request body (which may contain PII)
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


# Include routers
app.include_router(sessions.router)
app.include_router(github_router.router)
app.include_router(conversation.router)
app.include_router(puzzle.router)
app.include_router(analytics.router)


# ---------------------------------------------------------------------------
# Root endpoints
# ---------------------------------------------------------------------------

@app.get("/", tags=["meta"])
async def root() -> dict[str, Any]:
    return {
        "name": "DevCoach API",
        "version": "1.0.0",
        "environment": settings.environment,
        "docs": "/docs",
    }


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    """Lightweight health check — does not hit the database."""
    return {"status": "ok"}
