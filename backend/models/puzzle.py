from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


class PuzzleAttempt(Base):
    __tablename__ = "puzzle_attempts"
    __table_args__ = (
        UniqueConstraint("user_id", "puzzle_date", name="uq_puzzle_attempts_user_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    puzzle_date: Mapped[date] = mapped_column(Date, nullable=False)
    puzzle_type: Mapped[str] = mapped_column(Text, nullable=False)
    puzzle_content: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    completed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    time_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="puzzle_attempts", lazy="noload")


class Badge(Base):
    __tablename__ = "badges"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    badge_type: Mapped[str] = mapped_column(Text, nullable=False)
    earned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    github_noted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="badges", lazy="noload")


class CoachingProfile(Base):
    __tablename__ = "coaching_profiles"
    __table_args__ = (
        UniqueConstraint("user_id", "week_start", name="uq_coaching_profiles_user_week"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    prs_merged: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    prs_reviewed: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    issues_annotated: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    avg_review_latency_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    annotation_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    coaching_level: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    user: Mapped["User"] = relationship(
        "User", back_populates="coaching_profiles", lazy="noload"
    )
