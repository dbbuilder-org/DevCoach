# DevCoach Coaching Model

## The Two Archetypes

DevCoach was designed around two real engineering patterns observed on a client team:

**Peter** (high autonomy): Self-directs. Reviews PRs unprompted. Files follow-up bugs. Merges clean work. Doesn't need hand-holding — needs visibility into impact and velocity.

**Ransom** (needs structure): Technically capable but struggles with task selection, issue annotation, regression awareness, and team communication. The gap is habit, not skill.

The coaching model doesn't judge — it adapts.

## Detection Signals

Coaching level is computed weekly from `coaching_profiles` data:

| Signal | Peter Threshold | Ransom Indicator |
|--------|----------------|-----------------|
| PRs merged / week | ≥ 3 | < 3 |
| PRs reviewed / week | ≥ 5 | < 5 |
| Annotation rate | ≥ 80% | < 80% |
| Avg review latency | < 24h | ≥ 24h |

If all thresholds met: Peter mode. Otherwise: Ransom mode. Mode is re-evaluated weekly, not daily.

## Conversation Philosophy

Built on three books:

1. **Uptime** (Alex Soojung-Kim Pang): Energy management. Structure the day so hard work happens when energy is high. Protect breaks.

2. **Atomic Habits** (James Clear): 1% daily improvements. Habit stacking. Identity-based change ("I'm the kind of engineer who annotates every issue" not "I should annotate issues").

3. **Math Test Method**: Work the issues you understand first. Build momentum. Then tackle the unknowns with energy and confidence.

## Haiku System Prompt Principles

- **Encouraging, not threatening** — the AI is a coach, not a critic
- **Socratic first** — ask questions before giving answers
- **Context-aware** — references the specific issue/PR title and phase
- **Habit-building** — always names the small action: "Did you comment on the issue?"
- **Never says "you should have"** — always "what if you tried"
- **Brief in Peter mode, warmer in Ransom mode**

## Trigger Events

| Trigger | When | Message Style |
|---------|------|--------------|
| `phase_transition` | Moving to next phase | "Moving to Test — what changed? What could break?" |
| `stuck` | No activity for 10+ min (Ransom) or 15+ min (Peter) | "Looks like you've been quiet. What's blocking you?" |
| `pomodoro_break` | Every 25 min | "Break time. Is your current approach the right one?" |
| `pre_merge` | PR phase entered | "Before you merge — did you annotate the issue?" |
| `day_end` | Day close panel opened | "What's one thing you'd do differently tomorrow?" |
| `puzzle_complete` | Puzzle solved | "That same methodical approach — how would you apply it to [issue]?" |

## Ransom Mode Specifics

Extra coaching behaviors active in Ransom mode:
- Check-in prompt every Pomodoro cycle (25 min)
- Explicit annotation reminder before leaving PR phase
- Regression guard prompt when entering Test phase: "What did you change? What could you have broken?"
- Daily update reminder: "Have you posted a status in the team channel today?"
- `should_prompt()` returns true more aggressively

## Peter Mode Specifics

- Minimal interruption during work blocks
- Coaching messages are peer-level and brief
- Focus on team impact metrics: "You reviewed 3 PRs yesterday. Can you hit 4 today?"
- `should_prompt()` only returns true for `stuck` trigger after 15+ min of silence

## Badge Progression (Ransom → Peter)

The badge system is designed to make the Ransom-to-Peter transition visible and celebrated:

| Badge | Trigger | Meaning |
|-------|---------|---------|
| Communicator | annotation_rate ≥ 90% for 2 consecutive weeks | Making your work legible to the team |
| Reviewer | avg_review_latency_hours < 24 for 1 week | Unblocking teammates fast |
| Velocity | prs_merged ≥ 5 in a week | Shipping consistently |
| Daily Puzzle | Puzzle solved in ≤ 15 min | Warm-up habit established |
| Weekly Streak | All 5 weekday puzzles within limit | Consistent daily warm-up |
| PR Streak | 5 consecutive days with ≥ 1 merged PR | Shipping every day |
