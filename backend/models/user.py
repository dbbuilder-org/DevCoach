from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    github_username: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    github_token_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    coaching_level: Mapped[str] = mapped_column(
        Text, nullable=False, default="ransom", server_default="ransom"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # Relationships
    day_sessions: Mapped[list] = relationship(
        "DaySession", back_populates="user", lazy="noload"
    )
    conversations: Mapped[list] = relationship(
        "Conversation", back_populates="user", lazy="noload"
    )
    puzzle_attempts: Mapped[list] = relationship(
        "PuzzleAttempt", back_populates="user", lazy="noload"
    )
    badges: Mapped[list] = relationship(
        "Badge", back_populates="user", lazy="noload"
    )
    coaching_profiles: Mapped[list] = relationship(
        "CoachingProfile", back_populates="user", lazy="noload"
    )
