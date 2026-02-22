from __future__ import annotations

import json
from typing import Any

import anthropic

_MODEL = "claude-haiku-4-5-20251001"

# ---------------------------------------------------------------------------
# System prompt builder
# ---------------------------------------------------------------------------

_COACHING_PHILOSOPHY = """
You are DevCoach, an AI pair-programming coach. Your philosophy:
- Be encouraging, never condescending
- Ask Socratic questions — help the developer reach their own answers
- Stay context-aware: reference what they're working on
- Build good habits incrementally — celebrate small wins
- Never say "you should have" or place blame
- Be concise in async messages; be conversational in chat
- When someone is stuck, help them articulate the problem rather than just handing the answer
""".strip()


def _build_system_prompt(context: dict[str, Any]) -> str:
    coaching_level = context.get("coaching_level", "ransom")
    current_phase = context.get("current_phase", "")
    current_item = context.get("current_item", {})
    journal_context = context.get("journal_context", "")

    level_guidance = (
        "This developer is experienced (Peter coaching mode). Be peer-like, "
        "prompt only when they seem genuinely stuck, trust their judgment."
        if coaching_level == "peter"
        else
        "This developer is still building habits (Ransom coaching mode). Be "
        "nurturing and proactive, prompt at every phase transition, celebrate "
        "every completion, reinforce good practices gently."
    )

    item_context = ""
    if current_item:
        item_context = (
            f"\nCurrent work item: {current_item.get('title', 'Unknown')} "
            f"(#{current_item.get('number', '')}), "
            f"type={current_item.get('type', '')}, "
            f"phase={current_phase or 'not started'}."
        )

    time_context = ""
    if context.get("time_in_phase"):
        time_context = f" Time spent in current phase: {context['time_in_phase']}."

    item_context += time_context

    journal_section = ""
    if journal_context:
        journal_section = f"\n\nRecent journal context:\n{journal_context[:2000]}"

    items_context = ""
    if context.get("todays_items"):
        items_list = ", ".join(str(i) for i in context["todays_items"][:3])
        items_context = f"\n\nToday's planned items: {items_list}"

    return (
        f"{_COACHING_PHILOSOPHY}\n\n"
        f"Coaching level guidance: {level_guidance}"
        f"{item_context}"
        f"{journal_section}"
        f"{items_context}"
    )


# ---------------------------------------------------------------------------
# Public functions
# ---------------------------------------------------------------------------

async def chat(
    messages: list[dict[str, str]],
    context: dict[str, Any],
    api_key: str,
) -> str:
    """
    Send a conversation to Claude Haiku and return the assistant reply text.

    messages: list of {"role": "user"|"assistant", "content": "..."}
    context: coaching context dict with keys coaching_level, current_phase, current_item, journal_context
    """
    client = anthropic.AsyncAnthropic(api_key=api_key)
    system_prompt = _build_system_prompt(context)

    response = await client.messages.create(
        model=_MODEL,
        max_tokens=1024,
        system=system_prompt,
        messages=messages,
    )
    return response.content[0].text


async def get_proactive_message(
    trigger: str,
    context: dict[str, Any],
    api_key: str,
) -> str:
    """
    Generate a short proactive coaching message based on a trigger event.

    trigger: "phase_transition" | "stuck" | "pomodoro_break" | "pre_merge" | "day_end" | "puzzle_complete"
    """
    trigger_prompts: dict[str, str] = {
        "phase_transition": (
            "The developer just finished a phase and is about to start the next one. "
            "Give a one-sentence encouraging nudge to keep momentum."
        ),
        "stuck": (
            "The developer has been on the same task for a while and may be stuck. "
            "Ask a single open-ended question to help them articulate the blocker. "
            "Keep it to 1-2 sentences."
        ),
        "pomodoro_break": (
            "The developer just completed a Pomodoro work block. "
            "Give a quick positive acknowledgment and suggest they step away for a few minutes. "
            "One sentence."
        ),
        "pre_merge": (
            "The developer is about to merge a PR. "
            "Give a short checklist reminder (2-3 bullets) of things to verify before merging."
        ),
        "day_end": (
            "The developer is wrapping up their coding session for the day. "
            "Give a warm, reflective 2-3 sentence message acknowledging their work "
            "and encouraging them to review what they accomplished."
        ),
        "puzzle_complete": (
            "The developer just completed a daily coding puzzle. "
            "Give a brief (1 sentence) congratulation and connect it to their real work."
        ),
    }
    trigger_prompts["pomodoro_complete"] = trigger_prompts["pomodoro_break"]
    trigger_prompts["phase_change"] = trigger_prompts["phase_transition"]
    trigger_prompts["stuck_signal"] = trigger_prompts["stuck"]
    trigger_prompts["day_start"] = "The developer is starting their day. Give a brief, energizing one-sentence welcome."

    user_message = trigger_prompts.get(
        trigger,
        "Give a brief, encouraging coaching message. 1-2 sentences.",
    )

    client = anthropic.AsyncAnthropic(api_key=api_key)
    system_prompt = _build_system_prompt(context)

    response = await client.messages.create(
        model=_MODEL,
        max_tokens=256,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )
    return response.content[0].text


async def generate_puzzle(
    puzzle_type: str,
    difficulty: int = 2,
    api_key: str = "",
) -> dict[str, Any]:
    """
    Generate a daily coding puzzle.

    puzzle_type: "debug_snippet" | "logic_reasoning" | "sql_regex" | "algorithm_mini"
    difficulty: 1-5 (1=easiest, 5=hardest)
    Returns: {type, question, hint, answer, explanation}
    """
    type_descriptions = {
        "debug_snippet": (
            "a short code snippet (10-20 lines, Python or JavaScript) that has a subtle bug. "
            "Ask the developer to identify and fix the bug."
        ),
        "logic_reasoning": (
            "a logical reasoning or algorithmic thinking problem. "
            "Could be a word problem, sequence, or simple deduction puzzle."
        ),
        "sql_regex": (
            "a SQL query challenge or regex pattern matching problem. "
            "Provide a scenario and ask them to write the query or regex."
        ),
        "algorithm_mini": (
            "a mini algorithm challenge solvable in under 30 minutes. "
            "Focus on arrays, strings, or basic data structures."
        ),
    }
    type_desc = type_descriptions.get(puzzle_type, type_descriptions["logic_reasoning"])
    difficulty_label = ["trivial", "easy", "medium", "hard", "expert"][min(difficulty - 1, 4)]

    prompt = (
        f"Create {type_desc}\n"
        f"Difficulty: {difficulty_label} (level {difficulty}/5).\n\n"
        "Respond with valid JSON only, no markdown fences, matching exactly this schema:\n"
        '{"type": "...", "question": "...", "hint": "...", "answer": "...", "explanation": "..."}'
    )

    client = anthropic.AsyncAnthropic(api_key=api_key)
    response = await client.messages.create(
        model=_MODEL,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text.strip()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        # Attempt to extract JSON from markdown code fence if model wrapped it
        import re
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            parsed = json.loads(match.group(0))
        else:
            raise ValueError(f"Could not parse puzzle JSON from model response: {raw[:200]}")

    parsed["type"] = puzzle_type
    return parsed


async def evaluate_puzzle_answer(
    puzzle: dict[str, Any],
    user_answer: str,
    api_key: str = "",
) -> dict[str, Any]:
    """
    Evaluate a user's puzzle answer.
    Returns: {correct: bool, score: float, feedback: str}
    """
    prompt = (
        f"Puzzle type: {puzzle.get('type')}\n"
        f"Question: {puzzle.get('question')}\n"
        f"Expected answer: {puzzle.get('answer')}\n"
        f"Explanation: {puzzle.get('explanation')}\n\n"
        f"User's answer: {user_answer}\n\n"
        "Evaluate the user's answer. Is it correct or substantially correct?\n"
        "Respond with valid JSON only, no markdown fences:\n"
        '{"correct": true/false, "score": 0.0-1.0, "feedback": "short encouraging feedback"}'
    )

    client = anthropic.AsyncAnthropic(api_key=api_key)
    response = await client.messages.create(
        model=_MODEL,
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text.strip()
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        import re
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            result = json.loads(match.group(0))
        else:
            result = {
                "correct": False,
                "score": 0.0,
                "feedback": "Could not evaluate your answer automatically. Please review the explanation.",
            }

    return {
        "correct": bool(result.get("correct", False)),
        "score": float(result.get("score", 0.0)),
        "feedback": str(result.get("feedback", "")),
    }
