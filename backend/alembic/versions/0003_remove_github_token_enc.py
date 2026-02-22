"""Remove github_token_enc — Clerk OAuth token replaces stored PAT

Revision ID: 0003
Revises: 0002
Create Date: 2026-02-22
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("users", "github_token_enc")


def downgrade() -> None:
    op.add_column("users", sa.Column("github_token_enc", sa.Text(), nullable=True))
