from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import CurrentUser
from config import settings
from db import get_db
from models.conversation import Conversation
from services.haiku_service import chat, get_proactive_message

router = APIRouter(prefix="/conversation", tags=["conversation"])

# ---------------------------------------------------------------------------
# In-memory rate limiting (per user, per minute)
# ---------------------------------------------------------------------------

_rate_limit: dict[str, list[float]] = {}
CHAT_RATE_LIMIT = 20  # requests per minute per user


def _check_rate_limit(user_id: str) -> None:
    """
    Enforce CHAT_RATE_LIMIT requests per 60-second window per user.
    Prunes stale timestamps on every call. Raises 429 if exceeded.
    """
    now = time.monotonic()
    window_start = now - 60.0
    timestamps = _rate_limit.get(user_id, [])
    # Prune entries older than 60 seconds
    timestamps = [t for t in timestamps if t > window_start]
    if len(timestamps) >= CHAT_RATE_LIMIT:
        _rate_limit[user_id] = timestamps
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded: 20 chat requests per minute",
        )
    timestamps.append(now)
    _rate_limit[user_id] = timestamps


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    session_id: str | None = Field(None, description="Day session UUID")
    message: str = Field(..., min_length=1, description="User message")
    context: dict[str, Any] = Field(default_factory=dict)


class ProactiveRequest(BaseModel):
    session_id: str | None = Field(None)
    trigger: str = Field(
        ...,
        description=(
            "phase_transition | stuck | pomodoro_break | pre_merge | day_end | puzzle_complete"
        ),
    )
    context: dict[str, Any] = Field(default_factory=dict)


class ConversationMessage(BaseModel):
    id: str
    role: str
    content: str
    trigger_event: str | None
    created_at: str


class ChatResponse(BaseModel):
    reply: str
    conversation_id: str


class ProactiveResponse(BaseModel):
    message: str
    trigger: str
    conversation_id: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(
    body: ChatRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ChatResponse:
    """Send a message to the coaching assistant and receive a reply."""
    # Rate limiting — must be first check before any other logic
    _check_rate_limit(str(current_user.id))

    session_id: uuid.UUID | None = None
    if body.session_id:
        try:
            session_id = uuid.UUID(body.session_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid session_id."
            )

    # Load conversation history for context
    history = await _load_history(current_user.id, session_id, db, limit=20)
    messages = [{"role": m.role, "content": m.content} for m in history]
    messages.append({"role": "user", "content": body.message})

    context = dict(body.context)

    # Always inject coaching level from the user record
    context["coaching_level"] = current_user.coaching_level or "ransom"

    # If session_id is provided, enrich with current block info
    if session_id:
        from models.session import DaySession, WorkBlock as WorkBlockModel
        from sqlalchemy import select as sa_select
        block_stmt = (
            sa_select(WorkBlockModel)
            .where(
                WorkBlockModel.session_id == session_id,
                WorkBlockModel.ended_at.is_(None),
            )
            .order_by(WorkBlockModel.started_at.desc())
            .limit(1)
        )
        block_result = await db.execute(block_stmt)
        active_block = block_result.scalar_one_or_none()
        if active_block:
            context.setdefault("current_item", active_block.item_ref)
            context.setdefault("current_phase", active_block.phase)
            if active_block.started_at:
                elapsed_min = int(
                    (datetime.now(tz=timezone.utc) - active_block.started_at).total_seconds() / 60
                )
                context.setdefault("time_in_phase", f"{elapsed_min} minutes")

    reply_text = await chat(messages, context, settings.anthropic_api_key)

    # Persist both the user message and assistant reply
    user_msg = Conversation(
        id=uuid.uuid4(),
        user_id=current_user.id,
        session_id=session_id,
        role="user",
        content=body.message,
        created_at=datetime.now(tz=timezone.utc),
    )
    assistant_msg = Conversation(
        id=uuid.uuid4(),
        user_id=current_user.id,
        session_id=session_id,
        role="assistant",
        content=reply_text,
        created_at=datetime.now(tz=timezone.utc),
    )
    db.add(user_msg)
    db.add(assistant_msg)
    await db.commit()
    await db.refresh(assistant_msg)

    return ChatResponse(reply=reply_text, conversation_id=str(assistant_msg.id))


@router.post("/proactive", response_model=ProactiveResponse)
async def proactive_endpoint(
    body: ProactiveRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ProactiveResponse:
    """Generate and store a proactive coaching message for a trigger event."""
    valid_triggers = {
        "phase_transition",
        "stuck",
        "pomodoro_break",
        "pre_merge",
        "day_end",
        "puzzle_complete",
        # Frontend aliases
        "pomodoro_complete",
        "phase_change",
        "stuck_signal",
        "day_start",
    }
    if body.trigger not in valid_triggers:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"trigger must be one of: {', '.join(sorted(valid_triggers))}",
        )

    session_id: uuid.UUID | None = None
    if body.session_id:
        try:
            session_id = uuid.UUID(body.session_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid session_id."
            )

    context = dict(body.context)

    context["coaching_level"] = current_user.coaching_level or "ransom"

    if session_id:
        from models.session import DaySession, WorkBlock as WorkBlockModel
        from sqlalchemy import select as sa_select
        block_stmt = (
            sa_select(WorkBlockModel)
            .where(
                WorkBlockModel.session_id == session_id,
                WorkBlockModel.ended_at.is_(None),
            )
            .order_by(WorkBlockModel.started_at.desc())
            .limit(1)
        )
        block_result = await db.execute(block_stmt)
        active_block = block_result.scalar_one_or_none()
        if active_block:
            context.setdefault("current_item", active_block.item_ref)
            context.setdefault("current_phase", active_block.phase)
            if active_block.started_at:
                elapsed_min = int(
                    (datetime.now(tz=timezone.utc) - active_block.started_at).total_seconds() / 60
                )
                context.setdefault("time_in_phase", f"{elapsed_min} minutes")

    message_text = await get_proactive_message(body.trigger, context, settings.anthropic_api_key)

    record = Conversation(
        id=uuid.uuid4(),
        user_id=current_user.id,
        session_id=session_id,
        role="assistant",
        content=message_text,
        trigger_event=body.trigger,
        created_at=datetime.now(tz=timezone.utc),
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    return ProactiveResponse(
        message=message_text,
        trigger=body.trigger,
        conversation_id=str(record.id),
    )


@router.get("/{session_id}/history", response_model=list[ConversationMessage])
async def get_history(
    session_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> list[ConversationMessage]:
    """Return conversation history for a session."""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid session_id."
        )

    history = await _load_history(current_user.id, session_uuid, db, limit=100)
    return [
        ConversationMessage(
            id=str(m.id),
            role=m.role,
            content=m.content,
            trigger_event=m.trigger_event,
            created_at=m.created_at.isoformat(),
        )
        for m in history
    ]


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

async def _load_history(
    user_id: uuid.UUID,
    session_id: uuid.UUID | None,
    db: AsyncSession,
    limit: int = 20,
) -> list[Conversation]:
    stmt = select(Conversation).where(Conversation.user_id == user_id)
    if session_id is not None:
        stmt = stmt.where(Conversation.session_id == session_id)
    stmt = stmt.order_by(Conversation.created_at.asc()).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()
