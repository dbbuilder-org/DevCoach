from __future__ import annotations

import base64
from datetime import datetime, timezone

import httpx

_GITHUB_API = "https://api.github.com"
_JOURNAL_PATH = ".devcoach/journal.md"
_MAX_FILE_BYTES = 50 * 1024  # 50 KB


def _build_headers(pat: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {pat}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


async def _get_file_info(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    owner: str,
    repo: str,
) -> tuple[str | None, str | None]:
    """
    Returns (content, sha) of the journal file, or (None, None) if it doesn't exist.
    Content is decoded from base64.
    """
    resp = await client.get(
        f"{_GITHUB_API}/repos/{owner}/{repo}/contents/{_JOURNAL_PATH}",
        headers=headers,
    )
    if resp.status_code == 404:
        return None, None
    resp.raise_for_status()
    data = resp.json()
    content_b64 = data.get("content", "")
    # GitHub returns base64 with newlines
    content = base64.b64decode(content_b64.replace("\n", "")).decode("utf-8")
    sha = data.get("sha")
    return content, sha


async def read_journal(
    owner: str,
    repo: str,
    pat: str,
    days: int = 7,
) -> str:
    """
    Read the DevCoach journal from the repo and return the last N days of entries.
    Returns empty string if the file does not exist.
    """
    headers = _build_headers(pat)
    async with httpx.AsyncClient(timeout=20.0) as client:
        content, _ = await _get_file_info(client, headers, owner, repo)

    if not content:
        return ""

    # Each entry starts with "## " heading containing a date
    # Split on entry boundaries and keep only the last `days` worth
    import re

    sections = re.split(r"(?=^## )", content, flags=re.MULTILINE)
    recent: list[str] = []
    for section in reversed(sections):
        if not section.strip():
            continue
        recent.insert(0, section)
        if len(recent) >= days:
            break

    truncated = "".join(recent)
    # Guard against sending too much to the LLM
    return truncated[:3000]


async def append_journal_entry(
    owner: str,
    repo: str,
    pat: str,
    entry: str,
) -> bool:
    """
    Prepend a new entry to the journal file (newest first).
    Creates the file if it doesn't exist. Trims oldest entries to stay under 50 KB.
    Returns True on success.
    """
    headers = _build_headers(pat)
    async with httpx.AsyncClient(timeout=20.0) as client:
        existing_content, sha = await _get_file_info(client, headers, owner, repo)

        new_content = entry.rstrip() + "\n\n" + (existing_content or "")

        # Trim if over limit
        while len(new_content.encode("utf-8")) > _MAX_FILE_BYTES:
            last_section = new_content.rfind("\n## ")
            if last_section == -1:
                break
            new_content = new_content[:last_section]

        encoded = base64.b64encode(new_content.encode("utf-8")).decode("utf-8")

        payload: dict = {
            "message": "chore(devcoach): update journal",
            "content": encoded,
            "committer": {
                "name": "DevCoach",
                "email": "devcoach@noreply.github.com",
            },
        }
        if sha:
            payload["sha"] = sha

        resp = await client.put(
            f"{_GITHUB_API}/repos/{owner}/{repo}/contents/{_JOURNAL_PATH}",
            headers=headers,
            json=payload,
        )
        resp.raise_for_status()
    return True


def format_work_block_entry(block: dict, item: dict) -> str:
    """Format a completed work block into a journal markdown section."""
    started = block.get("started_at", "")
    ended = block.get("ended_at", "")
    phase = block.get("phase", "unknown")
    pr_url = block.get("pr_url", "")
    notes = block.get("notes", "")

    item_title = item.get("title", "Unknown item")
    item_number = item.get("number", "")
    item_type = item.get("type", "item")
    item_url = item.get("url", "")

    lines = [
        f"### Work Block — {item_type.capitalize()} #{item_number}: {item_title}",
        f"- Phase: {phase}",
        f"- Started: {started}",
        f"- Ended: {ended}",
    ]
    if item_url:
        lines.append(f"- Link: {item_url}")
    if pr_url:
        lines.append(f"- PR: {pr_url}")
    if notes:
        lines.append(f"- Notes: {notes}")

    return "\n".join(lines)


def format_day_summary(session: dict, blocks: list[dict]) -> str:
    """Format an end-of-day session summary for the journal."""
    today = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")
    started = session.get("started_at", "")
    ended = session.get("ended_at", "")
    feedback = session.get("day_feedback", "")

    block_summaries = []
    for block in blocks:
        item_ref = block.get("item_ref", {})
        title = item_ref.get("title", "Unknown")
        number = item_ref.get("number", "")
        phase = block.get("phase", "")
        entry = f"  - #{number} {title} (phase: {phase})"
        block_summaries.append(entry)

    lines = [
        f"## {today} — Day Summary",
        f"- Session: {started} → {ended}",
        f"- Work blocks completed: {len(blocks)}",
    ]
    if block_summaries:
        lines.append("- Items worked on:")
        lines.extend(block_summaries)
    if feedback:
        lines.append(f"\n**Reflection:** {feedback}")

    return "\n".join(lines)
