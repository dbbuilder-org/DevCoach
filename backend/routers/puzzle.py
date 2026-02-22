from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from auth import CurrentUser
from config import settings
from db import get_db
from services.puzzle_service import get_daily_puzzle, get_weekly_streak, submit_puzzle_answer

router = APIRouter(prefix="/puzzle", tags=["puzzle"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class PuzzleResponse(BaseModel):
    puzzle_date: str
    puzzle_type: str
    completed: bool
    question: str
    hint: str
    type: str


class SubmitAnswerRequest(BaseModel):
    puzzle_date: date = Field(..., description="Date of the puzzle being answered")
    answer: str = Field(..., min_length=1, description="User's answer")
    time_seconds: int = Field(..., ge=0, description="Time taken in seconds")


class SubmitAnswerResponse(BaseModel):
    correct: bool
    score: float
    feedback: str
    explanation: str = ""
    within_limit: bool
    badge_earned: dict | None


class WeeklyStreakResponse(BaseModel):
    days_completed: int
    all_within_limit: bool
    weekly_completions: list[bool] = []
    total_completed: int = 0
    badges: list[dict]


class BadgeItem(BaseModel):
    id: str
    badge_type: str
    earned_at: str
    github_noted: bool


class StreakGistRequest(BaseModel):
    week_start: str = Field(..., description="ISO date of the week start (YYYY-MM-DD)")
    days_completed: int = Field(..., ge=1, le=7)


class StreakGistResponse(BaseModel):
    gist_url: str | None
    success: bool


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/today", response_model=PuzzleResponse)
async def get_today_puzzle(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> PuzzleResponse:
    """Return today's puzzle. Generates it on first request."""
    today = date.today()
    puzzle = await get_daily_puzzle(
        puzzle_date=today,
        user_id=str(current_user.id),
        db=db,
        api_key=settings.anthropic_api_key,
    )
    return PuzzleResponse(**puzzle)


@router.post("/submit", response_model=SubmitAnswerResponse)
async def submit_answer(
    body: SubmitAnswerRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> SubmitAnswerResponse:
    """Submit an answer to a puzzle and receive feedback."""
    try:
        result = await submit_puzzle_answer(
            user_id=str(current_user.id),
            puzzle_date=body.puzzle_date,
            user_answer=body.answer,
            time_seconds=body.time_seconds,
            db=db,
            api_key=settings.anthropic_api_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    return SubmitAnswerResponse(**result)


@router.get("/streak", response_model=WeeklyStreakResponse)
async def get_streak(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> WeeklyStreakResponse:
    """Return the user's weekly puzzle streak status."""
    streak = await get_weekly_streak(
        user_id=str(current_user.id),
        db=db,
    )
    return WeeklyStreakResponse(**streak)


@router.get("/badges", response_model=list[BadgeItem])
async def get_badges(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> list[BadgeItem]:
    """Return all badges earned by the authenticated user."""
    from models.puzzle import Badge
    from sqlalchemy import select as sa_select
    stmt = (
        sa_select(Badge)
        .where(Badge.user_id == current_user.id)
        .order_by(Badge.earned_at.desc())
    )
    result = await db.execute(stmt)
    badges = result.scalars().all()
    return [
        BadgeItem(
            id=str(b.id),
            badge_type=b.badge_type,
            earned_at=b.earned_at.isoformat(),
            github_noted=b.github_noted,
        )
        for b in badges
    ]


@router.post("/streak-gist", response_model=StreakGistResponse)
async def create_streak_gist_endpoint(
    body: StreakGistRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> StreakGistResponse:
    """Create a GitHub Gist badge for a completed weekly puzzle streak."""
    from services.puzzle_service import create_streak_gist
    pat: str = getattr(current_user, "_pat", "")
    if not pat:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No GitHub PAT available.")
    gist_url = await create_streak_gist(
        github_username=current_user.github_username,
        pat=pat,
        week_start_iso=body.week_start,
        days_completed=body.days_completed,
    )
    return StreakGistResponse(gist_url=gist_url, success=gist_url is not None)
