from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Story-point to tier mapping
# ---------------------------------------------------------------------------
# Tier 1 = very easy (1 SP), Tier 5 = very hard (13+ SP)
_SP_TIER_MAP: list[tuple[int, int]] = [
    (1, 1),
    (2, 2),
    (3, 2),
    (5, 3),
    (8, 4),
    (13, 5),
]


def story_points_to_tier(sp: int | None) -> int:
    """
    Map story points to a 1-5 difficulty tier.
    None or 0 defaults to tier 3 (medium difficulty, unknown).
    """
    if sp is None or sp <= 0:
        return 3
    for threshold, tier in _SP_TIER_MAP:
        if sp <= threshold:
            return tier
    return 5


# ---------------------------------------------------------------------------
# Confidence score
# ---------------------------------------------------------------------------

def confidence_score(item: dict[str, Any], github_username: str) -> float:
    """
    Compute a confidence/priority score for a queue item.

    Formula: (1 / difficulty_tier) * familiarity_bonus * urgency_multiplier

    familiarity_bonus:
      1.5 — user has commented on this item
      1.3 — user is assigned
      1.0 — default

    urgency_multiplier:
      2.0 — priority is critical or blocker
      1.5 — priority is high
      1.3 — PR awaiting review from user
      1.0 — default
    """
    sp = item.get("story_points")
    tier = story_points_to_tier(sp)

    # Familiarity
    if item.get("user_commented", False):
        familiarity_bonus = 1.5
    elif item.get("is_assigned_to_user", False):
        familiarity_bonus = 1.3
    else:
        familiarity_bonus = 1.0

    # Urgency
    priority = (item.get("priority") or "").lower()
    if priority in ("critical", "blocker"):
        urgency_multiplier = 2.0
    elif priority == "high":
        urgency_multiplier = 1.5
    elif item.get("awaiting_review_from_user", False):
        urgency_multiplier = 1.3
    else:
        urgency_multiplier = 1.0

    return (1.0 / tier) * familiarity_bonus * urgency_multiplier


def _build_explanation(item: dict[str, Any], github_username: str) -> str:
    """Build a human-readable explanation of why an item was recommended."""
    reasons: list[str] = []

    priority = (item.get("priority") or "").lower()
    if priority in ("critical", "blocker"):
        reasons.append("marked as critical/blocker")
    elif priority == "high":
        reasons.append("high priority")

    if item.get("awaiting_review_from_user", False):
        reasons.append("your review has been requested")
    if item.get("is_assigned_to_user", False):
        reasons.append("assigned to you")
    if item.get("user_commented", False):
        reasons.append("you have prior context from a comment")

    sp = item.get("story_points")
    if sp is not None:
        tier = story_points_to_tier(sp)
        if tier <= 2:
            reasons.append(f"small scope ({sp} SP — good for a focused session)")
        elif tier >= 4:
            reasons.append(f"larger scope ({sp} SP — plan accordingly)")

    if not reasons:
        reasons.append("good fit based on difficulty tier and queue position")

    return "Recommended because: " + "; ".join(reasons) + "."


# ---------------------------------------------------------------------------
# Sorting and recommendations
# ---------------------------------------------------------------------------

def sort_queue_math_test(
    items: list[dict[str, Any]],
    github_username: str,
) -> list[dict[str, Any]]:
    """Return a copy of items sorted by confidence_score descending."""
    return sorted(
        items,
        key=lambda item: confidence_score(item, github_username),
        reverse=True,
    )


def recommend_top_three(
    items: list[dict[str, Any]],
    github_username: str,
) -> list[dict[str, Any]]:
    """
    Return the top 3 scored items, each with an 'explanation' field added.
    If fewer than 3 items exist, returns all of them.
    """
    sorted_items = sort_queue_math_test(items, github_username)
    top = sorted_items[:3]
    result: list[dict[str, Any]] = []
    for item in top:
        enriched = dict(item)
        enriched["score"] = round(confidence_score(item, github_username), 4)
        enriched["explanation"] = _build_explanation(item, github_username)
        result.append(enriched)
    return result
