from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Thresholds for coaching level detection
# ---------------------------------------------------------------------------
_PETER_PRs_MERGED_PER_WEEK = 3
_PETER_PRs_REVIEWED_PER_WEEK = 5
_PETER_ANNOTATION_RATE = 0.8


def detect_coaching_level(activity: dict[str, Any]) -> str:
    """
    Determine coaching level based on activity metrics.

    activity keys:
      prs_merged_7d: int
      prs_reviewed_7d: int
      annotation_rate: float (0.0 - 1.0)
      avg_review_latency_hours: float | None

    Returns "peter" if the developer meets senior thresholds, "ransom" otherwise.
    """
    prs_merged = int(activity.get("prs_merged_7d", 0))
    prs_reviewed = int(activity.get("prs_reviewed_7d", 0))
    annotation_rate = float(activity.get("annotation_rate") or 0.0)

    if (
        prs_merged >= _PETER_PRs_MERGED_PER_WEEK
        and prs_reviewed >= _PETER_PRs_REVIEWED_PER_WEEK
        and annotation_rate >= _PETER_ANNOTATION_RATE
    ):
        return "peter"
    return "ransom"


# ---------------------------------------------------------------------------
# Contextual nudge messages
# ---------------------------------------------------------------------------

_RANSOM_NUDGES: dict[str, list[str]] = {
    "planning": [
        "Let's set a clear intention for this block. What's the one thing you want to accomplish?",
        "Before you dive in, can you describe the expected outcome in one sentence?",
    ],
    "coding": [
        "Great progress! Remember to commit small and often.",
        "How's it going? If you're stuck, try explaining the problem out loud.",
        "Consider writing a quick comment about what you're building while it's fresh in your mind.",
    ],
    "review": [
        "Take a moment to read through your changes before requesting a review.",
        "Check: does every changed line have a clear reason for existing?",
    ],
    "idle": [
        "Looks like you've been quiet for a bit. Still making progress?",
        "Sometimes a short walk helps when you're stuck. Back in 5?",
    ],
    "default": [
        "You're doing great. Keep going!",
        "Every line of code is a step forward.",
    ],
}

_PETER_NUDGES: dict[str, list[str]] = {
    "stuck": [
        "Looks like you might be blocked. What's the crux of the problem?",
        "Have you tried rubber-duck debugging? Sometimes writing it out is enough.",
    ],
    "pre_merge": [
        "Before you merge: tests green, changelog updated, reviewer comments addressed?",
    ],
    "default": [],
}


def get_coaching_prompts(level: str, context: dict[str, Any]) -> list[str]:
    """
    Return contextual nudge messages for the current state.

    context keys:
      phase: str (planning | coding | review | idle)
      time_in_phase_minutes: int
    """
    phase = context.get("phase", "default")
    if level == "peter":
        return _PETER_NUDGES.get(phase, _PETER_NUDGES["default"])
    # ransom
    return _RANSOM_NUDGES.get(phase, _RANSOM_NUDGES["default"])


# ---------------------------------------------------------------------------
# Prompt gate — should we interrupt the developer right now?
# ---------------------------------------------------------------------------

def should_prompt(
    level: str,
    last_activity_minutes: int,
    phase: str,
) -> bool:
    """
    Decide whether the coaching system should send an unsolicited message.

    Peter (experienced): only interrupt if genuinely stuck (>15 minutes of inactivity
    during active phases).

    Ransom (developing habits): prompt on every pomodoro cycle (every ~25 minutes),
    and always at phase transitions (last_activity_minutes == 0 means just transitioned).
    """
    if level == "peter":
        active_phases = {"coding", "debugging", "review"}
        if phase in active_phases and last_activity_minutes > 15:
            return True
        return False

    # Ransom mode: prompt at phase transitions and every pomodoro cycle
    if last_activity_minutes == 0:
        # Phase just changed
        return True
    if last_activity_minutes > 0 and last_activity_minutes % 25 == 0:
        return True
    return False
