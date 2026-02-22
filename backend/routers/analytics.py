from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import CurrentUser
from db import get_db
from models.puzzle import Badge, CoachingProfile, PuzzleAttempt
from models.session import DaySession, WorkBlock

router = APIRouter(prefix="/analytics", tags=["analytics"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_recommendations(
    annotation_rate: float | None,
    focus_score: float,
    consistency_score: float,
    weekly_puzzle_streak: int,
) -> list[str]:
    recs: list[str] = []
    if annotation_rate is not None and annotation_rate < 0.7:
        recs.append("Comment on issues when you finish a work block — it builds team trust.")
    if focus_score < 0.4:
        recs.append("More time in the Address phase means less context-switching. Try the full Pomodoro.")
    if consistency_score < 0.6:
        recs.append("Showing up consistently beats long irregular sessions. Aim for daily commits.")
    if weekly_puzzle_streak < 3:
        recs.append("Daily puzzle warm-ups sharpen pattern recognition — try to hit 5 this week.")
    return recs


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class VelocityPoint(BaseModel):
    date: str
    prs_merged: int
    prs_reviewed: int


class PhaseBalance(BaseModel):
    phase: str
    total_minutes: float
    block_count: int


class CoachingSignals(BaseModel):
    annotation_rate: float | None
    avg_review_latency_hours: float | None
    weekly_puzzle_streak: int
    coaching_level: str | None
    focus_score: float = 0.0
    consistency_score: float = 0.0
    recommendations: list[str] = []


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/velocity", response_model=list[VelocityPoint])
async def get_velocity(
    days: int = Query(default=14, ge=1, le=90, description="Number of days to include"),
    current_user: CurrentUser = ...,
    db: AsyncSession = Depends(get_db),
) -> list[VelocityPoint]:
    """
    Return per-day PR velocity for the last N days.
    Data is sourced from coaching_profiles; days without records return zeros.
    """
    today = date.today()
    start_date = today - timedelta(days=days - 1)

    stmt = select(CoachingProfile).where(
        CoachingProfile.user_id == current_user.id,
        CoachingProfile.week_start >= start_date,
    ).order_by(CoachingProfile.week_start.asc())

    result = await db.execute(stmt)
    profiles = result.scalars().all()

    # Build a daily map from weekly profiles (approximate)
    daily: dict[str, dict[str, int]] = {}
    current = start_date
    while current <= today:
        daily[current.isoformat()] = {"prs_merged": 0, "prs_reviewed": 0}
        current += timedelta(days=1)

    for profile in profiles:
        week_key = profile.week_start.isoformat()
        if week_key in daily:
            daily[week_key]["prs_merged"] = profile.prs_merged
            daily[week_key]["prs_reviewed"] = profile.prs_reviewed

    return [
        VelocityPoint(
            date=d,
            prs_merged=vals["prs_merged"],
            prs_reviewed=vals["prs_reviewed"],
        )
        for d, vals in sorted(daily.items())
    ]


@router.get("/balance", response_model=list[PhaseBalance])
async def get_phase_balance(
    session_id: str | None = Query(None, description="Session UUID to analyze"),
    current_user: CurrentUser = ...,
    db: AsyncSession = Depends(get_db),
) -> list[PhaseBalance]:
    """
    Return time distribution across phases for a session (or all sessions if not specified).
    """
    blocks_stmt = (
        select(WorkBlock)
        .join(DaySession, WorkBlock.session_id == DaySession.id)
        .where(DaySession.user_id == current_user.id)
    )

    if session_id:
        try:
            session_uuid = uuid.UUID(session_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid session_id."
            )
        blocks_stmt = blocks_stmt.where(WorkBlock.session_id == session_uuid)

    result = await db.execute(blocks_stmt)
    blocks = result.scalars().all()

    phase_totals: dict[str, dict[str, Any]] = {}
    for block in blocks:
        phase = block.phase or "unknown"
        if block.started_at and block.ended_at:
            duration_minutes = (
                block.ended_at - block.started_at
            ).total_seconds() / 60.0
        else:
            duration_minutes = 0.0

        if phase not in phase_totals:
            phase_totals[phase] = {"total_minutes": 0.0, "block_count": 0}
        phase_totals[phase]["total_minutes"] += duration_minutes
        phase_totals[phase]["block_count"] += 1

    return [
        PhaseBalance(
            phase=phase,
            total_minutes=round(vals["total_minutes"], 2),
            block_count=vals["block_count"],
        )
        for phase, vals in sorted(phase_totals.items())
    ]


@router.get("/coaching-signals", response_model=CoachingSignals)
async def get_coaching_signals(
    current_user: CurrentUser = ...,
    db: AsyncSession = Depends(get_db),
) -> CoachingSignals:
    """
    Return the latest coaching signals for the authenticated user.
    """
    today = date.today()
    week_start = today - timedelta(days=today.weekday())

    # Latest coaching profile
    profile_stmt = (
        select(CoachingProfile)
        .where(CoachingProfile.user_id == current_user.id)
        .order_by(CoachingProfile.week_start.desc())
        .limit(1)
    )
    profile_result = await db.execute(profile_stmt)
    profile = profile_result.scalar_one_or_none()

    # Weekly puzzle streak
    puzzle_stmt = select(PuzzleAttempt).where(
        PuzzleAttempt.user_id == current_user.id,
        PuzzleAttempt.puzzle_date >= week_start,
        PuzzleAttempt.puzzle_date <= today,
        PuzzleAttempt.completed == True,  # noqa: E712
    )
    puzzle_result = await db.execute(puzzle_stmt)
    completed_puzzles = puzzle_result.scalars().all()

    # Compute focus_score: ratio of time in "address" phase vs total block time
    thirty_days_ago = today - timedelta(days=30)
    blocks_stmt = (
        select(WorkBlock)
        .join(DaySession, WorkBlock.session_id == DaySession.id)
        .where(
            DaySession.user_id == current_user.id,
            WorkBlock.started_at.isnot(None),
            WorkBlock.ended_at.isnot(None),
            DaySession.date >= thirty_days_ago,
        )
    )
    blocks_result = await db.execute(blocks_stmt)
    recent_blocks = blocks_result.scalars().all()

    total_minutes = sum(
        (b.ended_at - b.started_at).total_seconds() / 60
        for b in recent_blocks
        if b.ended_at and b.started_at
    )
    address_minutes = sum(
        (b.ended_at - b.started_at).total_seconds() / 60
        for b in recent_blocks
        if b.phase == "address" and b.ended_at and b.started_at
    )
    focus_score = (address_minutes / total_minutes) if total_minutes > 0 else 0.0

    # Compute consistency_score: fraction of last 14 weekdays with at least one block
    sessions_stmt = select(DaySession).where(
        DaySession.user_id == current_user.id,
        DaySession.date >= today - timedelta(days=14),
    )
    sessions_result = await db.execute(sessions_stmt)
    recent_sessions = sessions_result.scalars().all()
    active_dates = {s.date for s in recent_sessions}
    # Count weekdays in the last 14 days
    weekdays = [
        today - timedelta(days=i)
        for i in range(14)
        if (today - timedelta(days=i)).weekday() < 5
    ]
    consistency_score = len(active_dates & set(weekdays)) / len(weekdays) if weekdays else 0.0

    return CoachingSignals(
        annotation_rate=profile.annotation_rate if profile else None,
        avg_review_latency_hours=profile.avg_review_latency_hours if profile else None,
        weekly_puzzle_streak=len(completed_puzzles),
        coaching_level=profile.coaching_level if profile else current_user.coaching_level,
        focus_score=round(focus_score, 3),
        consistency_score=round(consistency_score, 3),
        recommendations=_build_recommendations(
            annotation_rate=profile.annotation_rate if profile else None,
            focus_score=focus_score,
            consistency_score=consistency_score,
            weekly_puzzle_streak=len(completed_puzzles),
        ),
    )
