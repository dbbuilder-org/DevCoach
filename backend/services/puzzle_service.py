from __future__ import annotations

import random
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.puzzle import Badge, PuzzleAttempt
from services.haiku_service import evaluate_puzzle_answer, generate_puzzle

# ---------------------------------------------------------------------------
# Puzzle type rotation schedule
# ---------------------------------------------------------------------------
_WEEKDAY_TYPES: dict[int, str] = {
    0: "debug_snippet",       # Monday
    1: "logic_reasoning",     # Tuesday
    2: "sql_regex",           # Wednesday
    3: "algorithm_mini",      # Thursday
    4: "debug_snippet",       # Friday — random among all
    5: "logic_reasoning",     # Saturday
    6: "logic_reasoning",     # Sunday
}
_ALL_TYPES = ["debug_snippet", "logic_reasoning", "sql_regex", "algorithm_mini"]


def _puzzle_type_for_date(puzzle_date: date) -> str:
    weekday = puzzle_date.weekday()
    if weekday == 4:  # Friday — random
        return random.choice(_ALL_TYPES)
    return _WEEKDAY_TYPES.get(weekday, "logic_reasoning")


# ---------------------------------------------------------------------------
# Public functions
# ---------------------------------------------------------------------------

async def get_daily_puzzle(
    puzzle_date: date,
    user_id: str,
    db: AsyncSession,
    api_key: str,
) -> dict[str, Any]:
    """
    Return the daily puzzle for the given date. Generates and persists it on first request.
    The returned dict does NOT include the 'answer' field.
    """
    user_uuid = uuid.UUID(user_id)

    stmt = select(PuzzleAttempt).where(
        PuzzleAttempt.user_id == user_uuid,
        PuzzleAttempt.puzzle_date == puzzle_date,
    )
    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()

    if existing and existing.puzzle_content:
        return _safe_puzzle_content(existing)

    # Generate a new puzzle
    puzzle_type = _puzzle_type_for_date(puzzle_date)
    puzzle_data = await generate_puzzle(puzzle_type=puzzle_type, difficulty=2, api_key=api_key)

    attempt = PuzzleAttempt(
        user_id=user_uuid,
        puzzle_date=puzzle_date,
        puzzle_type=puzzle_type,
        puzzle_content=puzzle_data,
        completed=False,
    )
    db.add(attempt)
    await db.commit()
    await db.refresh(attempt)

    return _safe_puzzle_content(attempt)


def _safe_puzzle_content(attempt: PuzzleAttempt) -> dict[str, Any]:
    """Return puzzle data without the answer field."""
    content = dict(attempt.puzzle_content or {})
    content.pop("answer", None)
    return {
        "puzzle_date": attempt.puzzle_date.isoformat(),
        "puzzle_type": attempt.puzzle_type,
        "completed": attempt.completed,
        "question": content.get("question", ""),
        "hint": content.get("hint", ""),
        "type": content.get("type", attempt.puzzle_type),
    }


async def submit_puzzle_answer(
    user_id: str,
    puzzle_date: date,
    user_answer: str,
    time_seconds: int,
    db: AsyncSession,
    api_key: str,
) -> dict[str, Any]:
    """
    Evaluate a submitted puzzle answer and record the attempt.
    Returns {correct, score, feedback, explanation, within_limit, badge_earned}.
    """
    user_uuid = uuid.UUID(user_id)

    stmt = select(PuzzleAttempt).where(
        PuzzleAttempt.user_id == user_uuid,
        PuzzleAttempt.puzzle_date == puzzle_date,
    )
    result = await db.execute(stmt)
    attempt = result.scalar_one_or_none()

    if not attempt:
        raise ValueError(f"No puzzle found for date {puzzle_date}. Fetch today's puzzle first.")

    full_puzzle = dict(attempt.puzzle_content or {})
    evaluation = await evaluate_puzzle_answer(full_puzzle, user_answer, api_key=api_key)
    explanation = full_puzzle.get("explanation", "")

    # Consider "within limit" as completing in under 15 minutes per plan spec
    within_limit = time_seconds <= 900  # 15 minutes per plan spec

    attempt.completed = evaluation["correct"]
    attempt.time_seconds = time_seconds
    await db.commit()

    # Check weekly streak and award badge if warranted
    badge_earned = await _check_and_award_weekly_badge(user_uuid, puzzle_date, db)

    return {
        "correct": evaluation["correct"],
        "score": evaluation["score"],
        "feedback": evaluation["feedback"],
        "explanation": explanation,
        "within_limit": within_limit,
        "badge_earned": badge_earned,
    }


async def _check_and_award_weekly_badge(
    user_id: uuid.UUID,
    puzzle_date: date,
    db: AsyncSession,
) -> dict[str, Any] | None:
    """Award a weekly puzzle badge if the user has completed all puzzles this week."""
    # Find the Monday of the current week
    week_start = puzzle_date - timedelta(days=puzzle_date.weekday())
    week_end = week_start + timedelta(days=6)

    stmt = select(PuzzleAttempt).where(
        PuzzleAttempt.user_id == user_id,
        PuzzleAttempt.puzzle_date >= week_start,
        PuzzleAttempt.puzzle_date <= week_end,
        PuzzleAttempt.completed == True,  # noqa: E712
    )
    result = await db.execute(stmt)
    completed_this_week = result.scalars().all()

    # Need at least 5 weekday completions for the badge
    if len(completed_this_week) < 5:
        return None

    # Check if badge already awarded for this week
    badge_stmt = select(Badge).where(
        Badge.user_id == user_id,
        Badge.badge_type == f"weekly_puzzle_{week_start.isoformat()}",
    )
    badge_result = await db.execute(badge_stmt)
    existing_badge = badge_result.scalar_one_or_none()
    if existing_badge:
        return None

    badge = Badge(
        user_id=user_id,
        badge_type=f"weekly_puzzle_{week_start.isoformat()}",
        earned_at=datetime.now(tz=timezone.utc),
        github_noted=False,
    )
    db.add(badge)
    await db.commit()
    await db.refresh(badge)

    return {
        "id": str(badge.id),
        "badge_type": badge.badge_type,
        "earned_at": badge.earned_at.isoformat(),
        "message": "Weekly puzzle streak complete! Badge earned.",
    }


async def get_weekly_streak(
    user_id: str,
    db: AsyncSession,
) -> dict[str, Any]:
    """Return the current weekly streak status for the user."""
    user_uuid = uuid.UUID(user_id)
    today = date.today()
    week_start = today - timedelta(days=today.weekday())

    stmt = select(PuzzleAttempt).where(
        PuzzleAttempt.user_id == user_uuid,
        PuzzleAttempt.puzzle_date >= week_start,
        PuzzleAttempt.puzzle_date <= today,
    )
    result = await db.execute(stmt)
    attempts = result.scalars().all()

    completed = [a for a in attempts if a.completed]
    all_within_limit = all(
        (a.time_seconds or 9999) <= 1800 for a in completed
    )

    # Fetch badges earned this week
    badge_stmt = select(Badge).where(
        Badge.user_id == user_uuid,
        Badge.earned_at >= datetime.combine(week_start, datetime.min.time()).replace(tzinfo=timezone.utc),
    )
    badge_result = await db.execute(badge_stmt)
    badges = badge_result.scalars().all()

    # Build per-weekday completion array [Mon, Tue, Wed, Thu, Fri]
    weekday_completed: dict[int, bool] = {}
    for a in attempts:
        if a.completed:
            weekday_completed[a.puzzle_date.weekday()] = True

    weekly_completions = [weekday_completed.get(i, False) for i in range(5)]

    return {
        "days_completed": len(completed),
        "all_within_limit": all_within_limit,
        "weekly_completions": weekly_completions,  # [Mon, Tue, Wed, Thu, Fri]
        "total_completed": len(completed),
        "badges": [
            {"badge_type": b.badge_type, "earned_at": b.earned_at.isoformat()}
            for b in badges
        ],
    }


async def create_streak_gist(
    github_username: str,
    pat: str,
    week_start_iso: str,
    days_completed: int,
) -> str | None:
    """
    Create a GitHub Gist with a DevCoach weekly puzzle streak badge card.
    Returns the Gist URL on success, None on failure.
    """
    import httpx

    badge_md = f"""# DevCoach Weekly Puzzle Streak 🏅

**{github_username}** completed {days_completed}/5 daily puzzles for the week of {week_start_iso}.

[![DevCoach Puzzle Streak](https://img.shields.io/badge/DevCoach-{days_completed}%2F5_puzzles-brightgreen?style=flat-square&logo=github)](https://github.com/{github_username})

*Generated by [DevCoach](https://github.com/devcoach) on {week_start_iso}*
"""
    payload = {
        "description": f"DevCoach Weekly Puzzle Streak — {week_start_iso}",
        "public": True,
        "files": {
            f"devcoach-streak-{week_start_iso}.md": {
                "content": badge_md,
            }
        },
    }
    headers = {
        "Authorization": f"Bearer {pat}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post("https://api.github.com/gists", headers=headers, json=payload)
            resp.raise_for_status()
            return resp.json().get("html_url")
    except Exception:
        return None
