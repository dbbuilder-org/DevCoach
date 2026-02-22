from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from auth import CurrentUser
from db import get_db
from services.github_service import get_queue, get_user_activity, get_repo_health
from services.scoring_service import recommend_top_three, sort_queue_math_test

router = APIRouter(prefix="/github", tags=["github"])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class QueueItem(BaseModel):
    type: str
    number: int
    title: str
    url: str
    state: str
    labels: list[str]
    story_points: int | None
    priority: str
    assignees: list[str]
    is_assigned_to_user: bool
    awaiting_review_from_user: bool = False
    user_commented: bool
    score: float | None = None
    explanation: str | None = None


class ActivityMetrics(BaseModel):
    prs_merged_7d: int
    prs_reviewed_7d: int
    issue_comments_7d: int
    avg_review_latency_hours: float | None


class RepoHealthSection(BaseModel):
    issues_without_prs: list[QueueItem]
    prs_without_issues: list[QueueItem]
    prs_awaiting_review: list[QueueItem]
    stale_issues: list[QueueItem]
    total_hygiene_issues: int = 0


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/queue", response_model=list[QueueItem])
async def get_issue_queue(
    owner: str = Query(..., description="GitHub repo owner"),
    repo: str = Query(..., description="GitHub repo name"),
    current_user: CurrentUser = ...,
    db: AsyncSession = Depends(get_db),
) -> list[QueueItem]:
    """Return the open issue/PR queue, scored and sorted by confidence."""
    pat: str = getattr(current_user, "_pat", "")
    try:
        items = await get_queue(owner, repo, current_user.github_username, pat)
    except Exception:
        logger.exception("Failed to fetch queue from GitHub for %s/%s", owner, repo)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to fetch queue from GitHub.",
        )

    sorted_items = sort_queue_math_test(items, current_user.github_username)
    return [_enrich_item(item, current_user.github_username) for item in sorted_items]


@router.get("/queue/recommendations", response_model=list[QueueItem])
async def get_recommendations(
    owner: str = Query(..., description="GitHub repo owner"),
    repo: str = Query(..., description="GitHub repo name"),
    current_user: CurrentUser = ...,
    db: AsyncSession = Depends(get_db),
) -> list[QueueItem]:
    """Return top 3 recommended items for today's session."""
    pat: str = getattr(current_user, "_pat", "")
    try:
        items = await get_queue(owner, repo, current_user.github_username, pat)
    except Exception:
        logger.exception("Failed to fetch recommendations from GitHub for %s/%s", owner, repo)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to fetch queue from GitHub.",
        )

    top_three = recommend_top_three(items, current_user.github_username)
    return [_enrich_item(item, current_user.github_username) for item in top_three]


@router.get("/activity", response_model=ActivityMetrics)
async def get_activity(
    owner: str = Query(..., description="GitHub repo owner"),
    repo: str = Query(..., description="GitHub repo name"),
    current_user: CurrentUser = ...,
    db: AsyncSession = Depends(get_db),
) -> ActivityMetrics:
    """Return activity metrics for the authenticated user over the last 7 days."""
    pat: str = getattr(current_user, "_pat", "")
    try:
        activity = await get_user_activity(owner, repo, current_user.github_username, pat)
    except Exception:
        logger.exception("Failed to fetch activity from GitHub for %s/%s", owner, repo)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to fetch activity from GitHub.",
        )

    return ActivityMetrics(
        prs_merged_7d=activity.get("prs_merged_7d", 0),
        prs_reviewed_7d=activity.get("prs_reviewed_7d", 0),
        issue_comments_7d=activity.get("issue_comments_7d", 0),
        avg_review_latency_hours=activity.get("avg_review_latency_hours"),
    )


@router.get("/health", response_model=RepoHealthSection)
async def get_repo_health_endpoint(
    owner: str = Query(..., description="GitHub repo owner"),
    repo: str = Query(..., description="GitHub repo name"),
    current_user: CurrentUser = ...,
    db: AsyncSession = Depends(get_db),
) -> RepoHealthSection:
    """
    Return a repo hygiene report: issues without PRs, PRs without issues,
    PRs awaiting the user's review, and stale issues.
    """
    pat: str = getattr(current_user, "_pat", "")
    try:
        health = await get_repo_health(owner, repo, current_user.github_username, pat)
    except Exception:
        logger.exception("Failed to fetch repo health from GitHub for %s/%s", owner, repo)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to fetch repo health from GitHub.",
        )

    section = RepoHealthSection(
        issues_without_prs=[
            _enrich_item(item, current_user.github_username)
            for item in health["issues_without_prs"]
        ],
        prs_without_issues=[
            _enrich_item(item, current_user.github_username)
            for item in health["prs_without_issues"]
        ],
        prs_awaiting_review=[
            _enrich_item(item, current_user.github_username)
            for item in health["prs_awaiting_review"]
        ],
        stale_issues=[
            _enrich_item(item, current_user.github_username)
            for item in health["stale_issues"]
        ],
    )
    section.total_hygiene_issues = (
        len(section.issues_without_prs)
        + len(section.prs_without_issues)
        + len(section.prs_awaiting_review)
        + len(section.stale_issues)
    )
    return section


def _enrich_item(item: dict, github_username: str) -> QueueItem:
    from services.scoring_service import confidence_score

    return QueueItem(
        type=item.get("type", "issue"),
        number=item.get("number", 0),
        title=item.get("title", ""),
        url=item.get("url", ""),
        state=item.get("state", "open"),
        labels=item.get("labels", []),
        story_points=item.get("story_points"),
        priority=item.get("priority", "normal"),
        assignees=item.get("assignees", []),
        is_assigned_to_user=item.get("is_assigned_to_user", False),
        awaiting_review_from_user=item.get("awaiting_review_from_user", False),
        user_commented=item.get("user_commented", False),
        score=round(confidence_score(item, github_username), 4),
        explanation=item.get("explanation"),
    )
