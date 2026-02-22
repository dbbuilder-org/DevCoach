"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-02-21 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: str | None = None
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # users
    # ------------------------------------------------------------------
    op.create_table(
        "users",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("github_username", sa.Text, unique=True, nullable=False),
        sa.Column("github_token_enc", sa.Text, nullable=True),
        sa.Column(
            "coaching_level",
            sa.Text,
            nullable=False,
            server_default="ransom",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )
    op.create_index("ix_users_github_username", "users", ["github_username"])

    # ------------------------------------------------------------------
    # day_sessions
    # ------------------------------------------------------------------
    op.create_table(
        "day_sessions",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("date", sa.Date, nullable=False),
        sa.Column("planned_items", JSONB, nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("day_feedback", sa.Text, nullable=True),
        sa.UniqueConstraint("user_id", "date", name="uq_day_sessions_user_date"),
    )
    op.create_index("ix_day_sessions_user_id", "day_sessions", ["user_id"])
    op.create_index("ix_day_sessions_date", "day_sessions", ["date"])

    # ------------------------------------------------------------------
    # work_blocks
    # ------------------------------------------------------------------
    op.create_table(
        "work_blocks",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "session_id",
            UUID(as_uuid=True),
            sa.ForeignKey("day_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("item_ref", JSONB, nullable=False),
        sa.Column("phase", sa.Text, nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pr_url", sa.Text, nullable=True),
        sa.Column(
            "annotated",
            sa.Boolean,
            nullable=False,
            server_default="false",
        ),
        sa.Column("notes", sa.Text, nullable=True),
    )
    op.create_index("ix_work_blocks_session_id", "work_blocks", ["session_id"])

    # ------------------------------------------------------------------
    # conversations
    # ------------------------------------------------------------------
    op.create_table(
        "conversations",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "session_id",
            UUID(as_uuid=True),
            sa.ForeignKey("day_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("role", sa.Text, nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("trigger_event", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )
    op.create_index("ix_conversations_user_id", "conversations", ["user_id"])
    op.create_index("ix_conversations_session_id", "conversations", ["session_id"])
    op.create_index("ix_conversations_created_at", "conversations", ["created_at"])

    # ------------------------------------------------------------------
    # puzzle_attempts
    # ------------------------------------------------------------------
    op.create_table(
        "puzzle_attempts",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("puzzle_date", sa.Date, nullable=False),
        sa.Column("puzzle_type", sa.Text, nullable=False),
        sa.Column("puzzle_content", JSONB, nullable=True),
        sa.Column(
            "completed",
            sa.Boolean,
            nullable=False,
            server_default="false",
        ),
        sa.Column("time_seconds", sa.Integer, nullable=True),
        sa.UniqueConstraint(
            "user_id", "puzzle_date", name="uq_puzzle_attempts_user_date"
        ),
    )
    op.create_index("ix_puzzle_attempts_user_id", "puzzle_attempts", ["user_id"])
    op.create_index("ix_puzzle_attempts_puzzle_date", "puzzle_attempts", ["puzzle_date"])

    # ------------------------------------------------------------------
    # badges
    # ------------------------------------------------------------------
    op.create_table(
        "badges",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("badge_type", sa.Text, nullable=False),
        sa.Column(
            "earned_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "github_noted",
            sa.Boolean,
            nullable=False,
            server_default="false",
        ),
    )
    op.create_index("ix_badges_user_id", "badges", ["user_id"])
    op.create_index("ix_badges_badge_type", "badges", ["badge_type"])

    # ------------------------------------------------------------------
    # coaching_profiles
    # ------------------------------------------------------------------
    op.create_table(
        "coaching_profiles",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("week_start", sa.Date, nullable=False),
        sa.Column("prs_merged", sa.Integer, nullable=False, server_default="0"),
        sa.Column("prs_reviewed", sa.Integer, nullable=False, server_default="0"),
        sa.Column("issues_annotated", sa.Integer, nullable=False, server_default="0"),
        sa.Column("avg_review_latency_hours", sa.Float, nullable=True),
        sa.Column("annotation_rate", sa.Float, nullable=True),
        sa.Column("coaching_level", sa.Text, nullable=True),
        sa.UniqueConstraint(
            "user_id", "week_start", name="uq_coaching_profiles_user_week"
        ),
    )
    op.create_index(
        "ix_coaching_profiles_user_id", "coaching_profiles", ["user_id"]
    )
    op.create_index(
        "ix_coaching_profiles_week_start", "coaching_profiles", ["week_start"]
    )


def downgrade() -> None:
    op.drop_table("coaching_profiles")
    op.drop_table("badges")
    op.drop_table("puzzle_attempts")
    op.drop_table("conversations")
    op.drop_table("work_blocks")
    op.drop_table("day_sessions")
    op.drop_table("users")
