from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


class DaySession(Base):
    __tablename__ = "day_sessions"
    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_day_sessions_user_date"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    planned_items: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    day_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    repo_owner: Mapped[str | None] = mapped_column(Text, nullable=True)
    repo_name: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="day_sessions", lazy="noload")
    work_blocks: Mapped[list["WorkBlock"]] = relationship(
        "WorkBlock", back_populates="session", lazy="noload"
    )
    conversations: Mapped[list] = relationship(
        "Conversation", back_populates="session", lazy="noload"
    )


class WorkBlock(Base):
    __tablename__ = "work_blocks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("day_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    item_ref: Mapped[dict] = mapped_column(JSONB, nullable=False)
    phase: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    pr_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    annotated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    session: Mapped["DaySession"] = relationship(
        "DaySession", back_populates="work_blocks", lazy="noload"
    )
