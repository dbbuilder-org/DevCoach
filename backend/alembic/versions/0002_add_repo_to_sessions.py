"""Add repo_owner and repo_name to day_sessions

Revision ID: 0002
Revises: 0001
Create Date: 2026-02-21
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("day_sessions", sa.Column("repo_owner", sa.Text(), nullable=True))
    op.add_column("day_sessions", sa.Column("repo_name", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("day_sessions", "repo_name")
    op.drop_column("day_sessions", "repo_owner")
