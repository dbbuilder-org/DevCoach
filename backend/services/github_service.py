from __future__ import annotations

import re
from typing import Any

import httpx

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_GITHUB_API = "https://api.github.com"
_SP_LABEL_RE = re.compile(r"^sp:(\d+)$", re.IGNORECASE)
_SP_BODY_RE = re.compile(r"\*\*Story\s+Points:\*\*\s*(\d+)", re.IGNORECASE)


def _build_headers(pat: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {pat}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _parse_story_points(labels: list[dict], body: str | None) -> int | None:
    for label in labels:
        m = _SP_LABEL_RE.match(label.get("name", ""))
        if m:
            return int(m.group(1))
    if body:
        m = _SP_BODY_RE.search(body)
        if m:
            return int(m.group(1))
    return None


def _extract_priority(labels: list[dict]) -> str:
    names = {lb.get("name", "").lower() for lb in labels}
    if names & {"critical", "blocker", "p0"}:
        return "critical"
    if names & {"high", "high-priority", "p1"}:
        return "high"
    return "normal"


def _normalize_issue(raw: dict, github_username: str) -> dict:
    labels = raw.get("labels", [])
    assignees = [a.get("login", "") for a in raw.get("assignees", [])]
    story_points = _parse_story_points(labels, raw.get("body", ""))
    priority = _extract_priority(labels)
    return {
        "type": "issue",
        "number": raw["number"],
        "title": raw["title"],
        "url": raw["html_url"],
        "state": raw.get("state", "open"),
        "labels": [lb["name"] for lb in labels],
        "story_points": story_points,
        "priority": priority,
        "assignees": assignees,
        "is_assigned_to_user": github_username in assignees,
        "user_commented": False,  # populated separately if needed
        "body": raw.get("body", ""),
        "created_at": raw.get("created_at"),
        "updated_at": raw.get("updated_at"),
    }


def _normalize_pr(raw: dict, github_username: str) -> dict:
    labels = raw.get("labels", [])
    assignees = [a.get("login", "") for a in raw.get("assignees", [])]
    requested_reviewers = [r.get("login", "") for r in raw.get("requested_reviewers", [])]
    story_points = _parse_story_points(labels, raw.get("body", ""))
    priority = _extract_priority(labels)
    awaiting_review = github_username in requested_reviewers
    return {
        "type": "pull_request",
        "number": raw["number"],
        "title": raw["title"],
        "url": raw["html_url"],
        "state": raw.get("state", "open"),
        "draft": raw.get("draft", False),
        "labels": [lb["name"] for lb in labels],
        "story_points": story_points,
        "priority": priority,
        "assignees": assignees,
        "is_assigned_to_user": github_username in assignees,
        "requested_reviewers": requested_reviewers,
        "awaiting_review_from_user": awaiting_review,
        "user_commented": False,
        "body": raw.get("body", ""),
        "created_at": raw.get("created_at"),
        "updated_at": raw.get("updated_at"),
        "merged_at": raw.get("merged_at"),
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def get_queue(
    owner: str,
    repo: str,
    github_username: str,
    pat: str,
) -> list[dict]:
    """Return open issues and PRs for a repo, enriched with metadata."""
    headers = _build_headers(pat)
    async with httpx.AsyncClient(timeout=30.0) as client:
        issues_resp, prs_resp = await _fetch_issues_and_prs(client, headers, owner, repo)

    items: list[dict] = []
    for raw in issues_resp:
        # GitHub issues endpoint includes PRs; skip them here
        if "pull_request" not in raw:
            items.append(_normalize_issue(raw, github_username))

    for raw in prs_resp:
        items.append(_normalize_pr(raw, github_username))

    return items


async def _fetch_issues_and_prs(
    client: httpx.AsyncClient,
    headers: dict,
    owner: str,
    repo: str,
) -> tuple[list[dict], list[dict]]:
    base = f"{_GITHUB_API}/repos/{owner}/{repo}"

    issues_resp = await client.get(
        f"{base}/issues",
        headers=headers,
        params={"state": "open", "per_page": 100},
    )
    issues_resp.raise_for_status()

    prs_resp = await client.get(
        f"{base}/pulls",
        headers=headers,
        params={"state": "open", "per_page": 100},
    )
    prs_resp.raise_for_status()

    return issues_resp.json(), prs_resp.json()


async def get_issue(
    owner: str,
    repo: str,
    number: int,
    pat: str,
) -> dict:
    """Fetch a single issue by number."""
    headers = _build_headers(pat)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{_GITHUB_API}/repos/{owner}/{repo}/issues/{number}",
            headers=headers,
        )
        resp.raise_for_status()
    return _normalize_issue(resp.json(), "")


async def get_pr(
    owner: str,
    repo: str,
    number: int,
    pat: str,
) -> dict:
    """Fetch a single pull request by number."""
    headers = _build_headers(pat)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{_GITHUB_API}/repos/{owner}/{repo}/pulls/{number}",
            headers=headers,
        )
        resp.raise_for_status()
    return _normalize_pr(resp.json(), "")


async def get_authenticated_user(pat: str) -> dict[str, Any]:
    """Return the GitHub user object for the given PAT."""
    headers = _build_headers(pat)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(f"{_GITHUB_API}/user", headers=headers)
        resp.raise_for_status()
    return resp.json()


async def get_user_activity(
    owner: str,
    repo: str,
    github_username: str,
    pat: str,
) -> dict:
    """
    Return activity metrics for a user in the last 7 days:
    - prs_merged_7d
    - prs_reviewed_7d
    - issue_comments_7d
    - avg_review_latency_hours
    """
    from datetime import datetime, timedelta, timezone

    seven_days_ago = datetime.now(tz=timezone.utc) - timedelta(days=7)
    since_iso = seven_days_ago.isoformat()
    headers = _build_headers(pat)

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Merged PRs authored by user
        search_resp = await client.get(
            f"{_GITHUB_API}/search/issues",
            headers=headers,
            params={
                "q": (
                    f"repo:{owner}/{repo} is:pr is:merged "
                    f"author:{github_username} merged:>={seven_days_ago.date().isoformat()}"
                ),
                "per_page": 100,
            },
        )
        search_resp.raise_for_status()
        prs_merged_7d = search_resp.json().get("total_count", 0)

        # Reviews submitted by user
        review_search = await client.get(
            f"{_GITHUB_API}/search/issues",
            headers=headers,
            params={
                "q": (
                    f"repo:{owner}/{repo} is:pr reviewed-by:{github_username} "
                    f"updated:>={seven_days_ago.date().isoformat()}"
                ),
                "per_page": 100,
            },
        )
        review_search.raise_for_status()
        prs_reviewed_7d = review_search.json().get("total_count", 0)

        # Issue comments
        comments_resp = await client.get(
            f"{_GITHUB_API}/repos/{owner}/{repo}/issues/comments",
            headers=headers,
            params={
                "since": since_iso,
                "per_page": 100,
            },
        )
        comments_resp.raise_for_status()
        all_comments = comments_resp.json()
        user_comments = [c for c in all_comments if c.get("user", {}).get("login") == github_username]
        issue_comments_7d = len(user_comments)

    return {
        "prs_merged_7d": prs_merged_7d,
        "prs_reviewed_7d": prs_reviewed_7d,
        "issue_comments_7d": issue_comments_7d,
        "avg_review_latency_hours": None,  # Would require per-PR timeline analysis
    }

# ---------------------------------------------------------------------------
# Repo health / orphaned work analysis
# ---------------------------------------------------------------------------

# Regex to detect issue references in PR bodies and titles
# matches: closes #123, fixes #123, resolves #123, refs #123, see #123, #123
_ISSUE_REF_RE = re.compile(
    r"(?:closes?|fixe?s?|resolves?|refs?|references?|see)?\s*#(\d+)",
    re.IGNORECASE,
)


def _extract_issue_refs(text: str | None) -> set[int]:
    """Return the set of issue numbers referenced in a PR body or title."""
    if not text:
        return set()
    return {int(m.group(1)) for m in _ISSUE_REF_RE.finditer(text)}


async def get_repo_health(
    owner: str,
    repo: str,
    github_username: str,
    pat: str,
) -> dict[str, list[dict]]:
    """
    Analyze the repo for orphaned / hygiene issues.

    Returns a dict with four lists:
      issues_without_prs  — open issues with no PR referencing them
      prs_without_issues  — open non-draft PRs whose body+title reference no issue
      prs_awaiting_review — open PRs where github_username is a requested reviewer
      stale_issues        — open issues last updated >7 days ago (assigned to user or unassigned)
    """
    from datetime import datetime, timedelta, timezone as tz

    headers = _build_headers(pat)
    async with httpx.AsyncClient(timeout=30.0) as client:
        issues_raw, prs_raw = await _fetch_issues_and_prs(client, headers, owner, repo)

    # Build a set of all issue numbers referenced by any open PR
    referenced_issue_numbers: set[int] = set()
    for pr in prs_raw:
        body = pr.get("body") or ""
        title = pr.get("title") or ""
        referenced_issue_numbers |= _extract_issue_refs(body)
        referenced_issue_numbers |= _extract_issue_refs(title)

    cutoff = datetime.now(tz=tz.utc) - timedelta(days=7)

    issues_without_prs: list[dict] = []
    stale_issues: list[dict] = []

    for raw in issues_raw:
        if "pull_request" in raw:
            continue  # GitHub issues API includes PRs — skip them
        number = raw["number"]
        normalized = _normalize_issue(raw, github_username)

        # Issues without PRs: not referenced by any open PR
        if number not in referenced_issue_numbers:
            issues_without_prs.append(normalized)

        # Stale issues: last update > 7 days ago, assigned to user or unassigned
        updated_str = raw.get("updated_at")
        if updated_str:
            updated_at = datetime.fromisoformat(updated_str.replace("Z", "+00:00"))
            if updated_at < cutoff:
                assignees = [a.get("login", "") for a in raw.get("assignees", [])]
                if not assignees or github_username in assignees:
                    stale_issues.append(normalized)

    prs_without_issues: list[dict] = []
    prs_awaiting_review: list[dict] = []

    for raw in prs_raw:
        normalized = _normalize_pr(raw, github_username)

        # PRs without issues: no issue reference in body or title
        body = raw.get("body") or ""
        title = raw.get("title") or ""
        refs = _extract_issue_refs(body) | _extract_issue_refs(title)
        if not refs and not raw.get("draft", False):
            prs_without_issues.append(normalized)

        # PRs awaiting review from this user
        requested_reviewers = [r.get("login", "") for r in raw.get("requested_reviewers", [])]
        if github_username in requested_reviewers:
            prs_awaiting_review.append(normalized)

    return {
        "issues_without_prs": issues_without_prs,
        "prs_without_issues": prs_without_issues,
        "prs_awaiting_review": prs_awaiting_review,
        "stale_issues": stale_issues,
    }
