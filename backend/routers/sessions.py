from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import CurrentUser
from config import settings
from db import get_db
from models.puzzle import CoachingProfile
from models.session import DaySession, WorkBlock
from models.user import User
from services import haiku_service
from services.coaching_service import detect_coaching_level
from services.github_service import get_queue
from services.journal_service import append_journal_entry, format_day_summary, read_journal
from services.scoring_service import recommend_top_three

router = APIRouter(prefix="/sessions", tags=["sessions"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class StartSessionRequest(BaseModel):
    owner: str = Field(..., description="GitHub repo owner")
    repo: str = Field(..., description="GitHub repo name")


class EndSessionRequest(BaseModel):
    day_feedback: str | None = Field(None, description="End-of-day reflection text")
    write_journal: bool = Field(True, description="Whether to write to GitHub journal")
    owner: str | None = Field(None, description="GitHub repo owner for journal write")
    repo: str | None = Field(None, description="GitHub repo name for journal write")


class StartBlockRequest(BaseModel):
    item_ref: dict[str, Any] = Field(..., description="Issue/PR reference dict")
    phase: str | None = Field(None, description="Starting phase (planning/coding/review)")


class UpdatePhaseRequest(BaseModel):
    phase: str = Field(..., description="New phase name")


class EndBlockRequest(BaseModel):
    pr_url: str | None = None
    annotated: bool = False
    notes: str | None = None


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class WorkBlockResponse(BaseModel):
    id: str
    session_id: str
    item_ref: dict[str, Any]
    phase: str | None
    started_at: str | None
    ended_at: str | None
    pr_url: str | None
    annotated: bool
    notes: str | None


class DaySessionResponse(BaseModel):
    id: str
    user_id: str
    date: str
    planned_items: Any | None
    started_at: str | None
    ended_at: str | None
    day_feedback: str | None
    owner: str | None = None
    repo: str | None = None
    streak_days: int = 0
    work_blocks: list[WorkBlockResponse] = []
    current_block: WorkBlockResponse | None = None
    journal_snippet: str = ""
    recommendations: list[dict[str, Any]] | None = None


class DaySummary(BaseModel):
    session_id: str
    date: str
    prs_merged: int = 0
    prs_reviewed: int = 0
    issues_annotated: int
    blocks_completed: int
    total_minutes: float
    puzzle_completed: bool = False
    velocity_vs_average: float = 1.0
    reflection: str = ""
    encouragement: str = ""


class JournalResponse(BaseModel):
    content: str


class StuckCheckResponse(BaseModel):
    should_prompt: bool
    coaching_level: str
    suggested_trigger: str


class CoachingProfileResponse(BaseModel):
    coaching_level: str
    annotation_rate: float | None
    avg_review_latency_hours: float | None
    prs_merged: int
    prs_reviewed: int
    week_start: str | None


def _block_to_response(block: WorkBlock) -> WorkBlockResponse:
    return WorkBlockResponse(
        id=str(block.id),
        session_id=str(block.session_id),
        item_ref=block.item_ref,
        phase=block.phase,
        started_at=block.started_at.isoformat() if block.started_at else None,
        ended_at=block.ended_at.isoformat() if block.ended_at else None,
        pr_url=block.pr_url,
        annotated=block.annotated,
        notes=block.notes,
    )


# ---------------------------------------------------------------------------
# Helper: build full DaySessionResponse
# ---------------------------------------------------------------------------

async def _load_session_response(
    session: DaySession,
    db: AsyncSession,
    pat: str,
    owner: str,
    repo: str,
    recommendations: list[dict[str, Any]] | None = None,
) -> DaySessionResponse:
    # Load work blocks ordered by started_at asc
    blocks_stmt = (
        select(WorkBlock)
        .where(WorkBlock.session_id == session.id)
        .order_by(WorkBlock.started_at.asc())
    )
    blocks_result = await db.execute(blocks_stmt)
    blocks = blocks_result.scalars().all()

    work_block_responses = [_block_to_response(b) for b in blocks]

    # current_block = most recent block where ended_at IS NULL
    current_block: WorkBlockResponse | None = None
    for b in reversed(blocks):
        if b.ended_at is None:
            current_block = _block_to_response(b)
            break

    # Streak: count distinct dates with ended_at IS NOT NULL in last 30 days,
    # counting backwards from today only while consecutive (breaks on missing day)
    thirty_days_ago = date.today() - timedelta(days=30)
    streak_stmt = (
        select(DaySession.date)
        .where(
            DaySession.user_id == session.user_id,
            DaySession.ended_at.isnot(None),
            DaySession.date >= thirty_days_ago,
        )
        .order_by(DaySession.date.desc())
    )
    streak_result = await db.execute(streak_stmt)
    ended_dates = {row for row in streak_result.scalars().all()}

    streak_days = 0
    check_date = date.today()
    while check_date >= thirty_days_ago:
        if check_date in ended_dates:
            streak_days += 1
            check_date -= timedelta(days=1)
        else:
            break

    # Read journal snippet if credentials available
    journal_snippet = ""
    if owner and repo and pat:
        try:
            journal_snippet = await read_journal(owner, repo, pat, days=3)
        except Exception:
            pass

    return DaySessionResponse(
        id=str(session.id),
        user_id=str(session.user_id),
        date=session.date.isoformat(),
        planned_items=session.planned_items,
        started_at=session.started_at.isoformat() if session.started_at else None,
        ended_at=session.ended_at.isoformat() if session.ended_at else None,
        day_feedback=session.day_feedback,
        owner=owner or session.repo_owner,
        repo=repo or session.repo_name,
        streak_days=streak_days,
        work_blocks=work_block_responses,
        current_block=current_block,
        journal_snippet=journal_snippet,
        recommendations=recommendations,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/start", response_model=DaySessionResponse, status_code=status.HTTP_201_CREATED)
async def start_session(
    body: StartSessionRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> DaySessionResponse:
    """Create or reactivate today's session and return recommended items."""
    today = date.today()

    # Check if a session already exists for today
    stmt = select(DaySession).where(
        DaySession.user_id == current_user.id,
        DaySession.date == today,
    )
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if session is None:
        session = DaySession(
            id=uuid.uuid4(),
            user_id=current_user.id,
            date=today,
            started_at=datetime.now(tz=timezone.utc),
            repo_owner=body.owner,
            repo_name=body.repo,
        )
        db.add(session)
    else:
        # Reactivating: update repo info if provided
        session.repo_owner = body.owner
        session.repo_name = body.repo

    await db.commit()
    await db.refresh(session)

    pat: str = getattr(current_user, "_pat", "")
    recommendations: list[dict[str, Any]] = []
    try:
        queue = await get_queue(body.owner, body.repo, current_user.github_username, pat)
        recommendations = recommend_top_three(queue, current_user.github_username)
    except Exception:
        pass

    return await _load_session_response(session, db, pat, body.owner, body.repo, recommendations)


@router.get("/today", response_model=DaySessionResponse)
async def get_today_session(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> DaySessionResponse:
    """Return today's session for the authenticated user."""
    today = date.today()
    stmt = select(DaySession).where(
        DaySession.user_id == current_user.id,
        DaySession.date == today,
    )
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No session started for today. POST /sessions/start to begin.",
        )

    pat: str = getattr(current_user, "_pat", "")
    owner = session.repo_owner or ""
    repo = session.repo_name or ""
    return await _load_session_response(session, db, pat, owner, repo)


@router.get("/coaching-profile", response_model=CoachingProfileResponse)
async def get_coaching_profile(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> CoachingProfileResponse:
    """Return the authenticated user's current coaching profile."""
    from datetime import date as date_type

    today_date = date_type.today()
    week_start = today_date - timedelta(days=today_date.weekday())

    profile_stmt = (
        select(CoachingProfile)
        .where(CoachingProfile.user_id == current_user.id)
        .order_by(CoachingProfile.week_start.desc())
        .limit(1)
    )
    profile_result = await db.execute(profile_stmt)
    profile = profile_result.scalar_one_or_none()

    return CoachingProfileResponse(
        coaching_level=current_user.coaching_level or "ransom",
        annotation_rate=profile.annotation_rate if profile else None,
        avg_review_latency_hours=profile.avg_review_latency_hours if profile else None,
        prs_merged=profile.prs_merged if profile else 0,
        prs_reviewed=profile.prs_reviewed if profile else 0,
        week_start=profile.week_start.isoformat() if profile else None,
    )


@router.post("/{session_id}/end", response_model=DaySummary)
async def end_session(
    session_id: str,
    body: EndSessionRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> DaySummary:
    """Close the session, optionally write journal entry, return day summary."""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid session_id.")

    stmt = select(DaySession).where(
        DaySession.id == session_uuid,
        DaySession.user_id == current_user.id,
    )
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")

    session.ended_at = datetime.now(tz=timezone.utc)
    session.day_feedback = body.day_feedback
    await db.commit()
    await db.refresh(session)

    # Fetch work blocks
    blocks_stmt = (
        select(WorkBlock)
        .where(WorkBlock.session_id == session.id)
        .order_by(WorkBlock.started_at.asc())
    )
    blocks_result = await db.execute(blocks_stmt)
    blocks = blocks_result.scalars().all()

    issues_annotated = sum(1 for b in blocks if b.annotated)
    blocks_completed = sum(1 for b in blocks if b.ended_at is not None)
    total_minutes = sum(
        (b.ended_at - b.started_at).total_seconds() / 60
        for b in blocks
        if b.ended_at is not None and b.started_at is not None
    )

    # Determine owner/repo for journal write: body overrides, fall back to session
    write_owner = body.owner or session.repo_owner or ""
    write_repo = body.repo or session.repo_name or ""

    pat: str = getattr(current_user, "_pat", "")

    if body.write_journal and write_owner and write_repo:
        try:
            session_dict = {
                "started_at": session.started_at.isoformat() if session.started_at else "",
                "ended_at": session.ended_at.isoformat() if session.ended_at else "",
                "day_feedback": session.day_feedback,
            }
            block_dicts = [
                {
                    "item_ref": b.item_ref,
                    "phase": b.phase,
                    "started_at": b.started_at.isoformat() if b.started_at else "",
                    "ended_at": b.ended_at.isoformat() if b.ended_at else "",
                    "pr_url": b.pr_url,
                    "notes": b.notes,
                }
                for b in blocks
            ]
            summary = format_day_summary(session_dict, block_dicts)
            await append_journal_entry(write_owner, write_repo, pat, summary)
        except Exception:
            pass

    # Update coaching profile for the current week
    from datetime import date as date_type

    today_date = date_type.today()
    week_start = today_date - timedelta(days=today_date.weekday())

    # Compute annotation rate from blocks
    total_blocks = len(blocks)
    annotated_blocks = sum(1 for b in blocks if b.annotated)
    annotation_rate = annotated_blocks / total_blocks if total_blocks > 0 else 0.0

    # Upsert CoachingProfile for this week
    profile_stmt = select(CoachingProfile).where(
        CoachingProfile.user_id == current_user.id,
        CoachingProfile.week_start == week_start,
    )
    profile_result = await db.execute(profile_stmt)
    profile = profile_result.scalar_one_or_none()

    if profile is None:
        profile = CoachingProfile(
            id=uuid.uuid4(),
            user_id=current_user.id,
            week_start=week_start,
        )
        db.add(profile)

    # Accumulate annotation stats (additive across sessions in the week)
    profile.issues_annotated = (profile.issues_annotated or 0) + annotated_blocks
    profile.annotation_rate = annotation_rate
    # coaching_level detection requires GitHub activity data we don't have at session end,
    # so only re-detect if we have fresh data; otherwise preserve existing level
    activity = {
        "prs_merged_7d": 0,
        "prs_reviewed_7d": 0,
        "annotation_rate": annotation_rate,
    }
    new_level = detect_coaching_level(activity)
    # Only upgrade to "peter" if annotation_rate threshold met; don't downgrade here
    if new_level == "peter" and current_user.coaching_level != "peter":
        current_user.coaching_level = "peter"
        profile.coaching_level = "peter"
    else:
        profile.coaching_level = profile.coaching_level or current_user.coaching_level or "ransom"

    await db.commit()
    await db.refresh(profile)

    # Generate encouragement via haiku_service
    encouragement = ""
    try:
        encouragement = await haiku_service.get_proactive_message(
            "day_end",
            {
                "coaching_level": current_user.coaching_level or "ransom",
                "blocks_completed": blocks_completed,
            },
            settings.anthropic_api_key,
        )
    except Exception:
        pass

    return DaySummary(
        session_id=str(session.id),
        date=session.date.isoformat(),
        prs_merged=0,
        prs_reviewed=0,
        issues_annotated=issues_annotated,
        blocks_completed=blocks_completed,
        total_minutes=total_minutes,
        puzzle_completed=False,
        velocity_vs_average=1.0,
        reflection=body.day_feedback or "",
        encouragement=encouragement,
    )


@router.get("/{session_id}/stuck-check", response_model=StuckCheckResponse)
async def stuck_check(
    session_id: str,
    minutes_idle: int = Query(default=0, ge=0, description="Minutes since last user activity"),
    current_user: CurrentUser = ...,
    db: AsyncSession = Depends(get_db),
) -> StuckCheckResponse:
    """Check whether the coaching system should send a stuck prompt."""
    from services.coaching_service import should_prompt as coaching_should_prompt

    level = current_user.coaching_level or "ransom"

    # Determine current phase
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid session_id.")

    block_stmt = (
        select(WorkBlock)
        .where(
            WorkBlock.session_id == session_uuid,
            WorkBlock.ended_at.is_(None),
        )
        .order_by(WorkBlock.started_at.desc())
        .limit(1)
    )
    block_result = await db.execute(block_stmt)
    active_block = block_result.scalar_one_or_none()
    phase = active_block.phase if active_block else "idle"

    prompt = coaching_should_prompt(level, minutes_idle, phase or "idle")

    return StuckCheckResponse(
        should_prompt=prompt,
        coaching_level=level,
        suggested_trigger="stuck" if minutes_idle > 5 else "phase_transition",
    )


@router.get("/{session_id}/journal", response_model=JournalResponse)
async def get_session_journal(
    session_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> JournalResponse:
    """Read the GitHub journal for the session's repo and return recent entries."""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid session_id.")

    stmt = select(DaySession).where(
        DaySession.id == session_uuid,
        DaySession.user_id == current_user.id,
    )
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")

    owner = session.repo_owner or ""
    repo = session.repo_name or ""
    pat: str = getattr(current_user, "_pat", "")

    if not owner or not repo or not pat:
        return JournalResponse(content="")

    try:
        content = await read_journal(owner, repo, pat, days=7)
    except Exception:
        content = ""

    return JournalResponse(content=content)


@router.post("/{session_id}/blocks/start", response_model=WorkBlockResponse, status_code=status.HTTP_201_CREATED)
async def start_work_block(
    session_id: str,
    body: StartBlockRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> WorkBlockResponse:
    """Start a new work block within a session."""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid session_id.")

    stmt = select(DaySession).where(
        DaySession.id == session_uuid,
        DaySession.user_id == current_user.id,
    )
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")

    block = WorkBlock(
        id=uuid.uuid4(),
        session_id=session.id,
        item_ref=body.item_ref,
        phase=body.phase,
        started_at=datetime.now(tz=timezone.utc),
    )
    db.add(block)
    await db.commit()
    await db.refresh(block)

    return _block_to_response(block)


@router.post("/{session_id}/blocks/{block_id}/phase", response_model=WorkBlockResponse)
async def update_block_phase(
    session_id: str,
    block_id: str,
    body: UpdatePhaseRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> WorkBlockResponse:
    """Update the current phase of a work block."""
    block = await _get_block(session_id, block_id, current_user, db)
    block.phase = body.phase
    await db.commit()
    await db.refresh(block)
    return _block_to_response(block)


@router.post("/{session_id}/blocks/{block_id}/end", response_model=WorkBlockResponse)
async def end_work_block(
    session_id: str,
    block_id: str,
    body: EndBlockRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> WorkBlockResponse:
    """End a work block and record completion metadata."""
    block = await _get_block(session_id, block_id, current_user, db)
    block.ended_at = datetime.now(tz=timezone.utc)
    block.pr_url = body.pr_url
    block.annotated = body.annotated
    block.notes = body.notes
    await db.commit()
    await db.refresh(block)
    return _block_to_response(block)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

async def _get_block(
    session_id: str,
    block_id: str,
    current_user: User,
    db: AsyncSession,
) -> WorkBlock:
    try:
        session_uuid = uuid.UUID(session_id)
        block_uuid = uuid.UUID(block_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid UUID.")

    session_stmt = select(DaySession).where(
        DaySession.id == session_uuid,
        DaySession.user_id == current_user.id,
    )
    session_result = await db.execute(session_stmt)
    if session_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")

    block_stmt = select(WorkBlock).where(
        WorkBlock.id == block_uuid,
        WorkBlock.session_id == session_uuid,
    )
    block_result = await db.execute(block_stmt)
    block = block_result.scalar_one_or_none()

    if block is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work block not found.")

    return block
