"""
Tests for services/scoring_service.py

Run with: pytest backend/tests/test_scoring.py -v
"""
from __future__ import annotations

import pytest

from services.scoring_service import (
    confidence_score,
    recommend_top_three,
    sort_queue_math_test,
    story_points_to_tier,
)


# ---------------------------------------------------------------------------
# story_points_to_tier
# ---------------------------------------------------------------------------

class TestStoryPointsToTier:
    def test_none_returns_tier_3(self):
        assert story_points_to_tier(None) == 3

    def test_zero_returns_tier_3(self):
        assert story_points_to_tier(0) == 3

    def test_negative_returns_tier_3(self):
        assert story_points_to_tier(-5) == 3

    def test_1_sp_is_tier_1(self):
        assert story_points_to_tier(1) == 1

    def test_2_sp_is_tier_2(self):
        assert story_points_to_tier(2) == 2

    def test_3_sp_is_tier_2(self):
        assert story_points_to_tier(3) == 2

    def test_5_sp_is_tier_3(self):
        assert story_points_to_tier(5) == 3

    def test_8_sp_is_tier_4(self):
        assert story_points_to_tier(8) == 4

    def test_13_sp_is_tier_5(self):
        assert story_points_to_tier(13) == 5

    def test_above_13_is_tier_5(self):
        assert story_points_to_tier(21) == 5
        assert story_points_to_tier(100) == 5

    def test_boundary_below_8(self):
        # 7 SP — between 5 and 8 — should be tier 4 (first threshold >= 7 is 8)
        assert story_points_to_tier(7) == 4

    def test_boundary_below_5(self):
        # 4 SP — between 3 and 5 — should be tier 3
        assert story_points_to_tier(4) == 3


# ---------------------------------------------------------------------------
# confidence_score
# ---------------------------------------------------------------------------

def _make_item(
    sp: int | None = None,
    priority: str = "normal",
    is_assigned: bool = False,
    user_commented: bool = False,
    awaiting_review: bool = False,
) -> dict:
    return {
        "story_points": sp,
        "priority": priority,
        "is_assigned_to_user": is_assigned,
        "user_commented": user_commented,
        "awaiting_review_from_user": awaiting_review,
    }


class TestConfidenceScore:
    def test_default_item_no_sp(self):
        # tier=3, familiarity=1.0, urgency=1.0 => 1/3 * 1.0 * 1.0
        score = confidence_score(_make_item(), "alice")
        assert abs(score - 1 / 3) < 1e-9

    def test_small_item_boosts_score(self):
        # 1 SP => tier=1, base score = 1.0
        score = confidence_score(_make_item(sp=1), "alice")
        assert abs(score - 1.0) < 1e-9

    def test_large_item_reduces_score(self):
        # 13 SP => tier=5, base score = 0.2
        score = confidence_score(_make_item(sp=13), "alice")
        assert abs(score - 0.2) < 1e-9

    def test_assigned_familiarity_bonus(self):
        # tier=3, familiarity=1.3, urgency=1.0 => 1/3 * 1.3
        score = confidence_score(_make_item(is_assigned=True), "alice")
        expected = (1 / 3) * 1.3
        assert abs(score - expected) < 1e-9

    def test_commented_familiarity_bonus(self):
        # user_commented trumps is_assigned: familiarity=1.5
        score = confidence_score(_make_item(user_commented=True, is_assigned=True), "alice")
        expected = (1 / 3) * 1.5
        assert abs(score - expected) < 1e-9

    def test_critical_urgency_multiplier(self):
        # tier=3, familiarity=1.0, urgency=2.0
        score = confidence_score(_make_item(priority="critical"), "alice")
        expected = (1 / 3) * 2.0
        assert abs(score - expected) < 1e-9

    def test_blocker_urgency_multiplier(self):
        score = confidence_score(_make_item(priority="blocker"), "alice")
        expected = (1 / 3) * 2.0
        assert abs(score - expected) < 1e-9

    def test_high_priority_urgency_multiplier(self):
        score = confidence_score(_make_item(priority="high"), "alice")
        expected = (1 / 3) * 1.5
        assert abs(score - expected) < 1e-9

    def test_awaiting_review_urgency_multiplier(self):
        score = confidence_score(_make_item(awaiting_review=True), "alice")
        expected = (1 / 3) * 1.3
        assert abs(score - expected) < 1e-9

    def test_critical_overrides_awaiting_review(self):
        # critical (2.0) takes precedence over awaiting_review (1.3)
        score_critical = confidence_score(_make_item(priority="critical", awaiting_review=True), "alice")
        score_awaiting = confidence_score(_make_item(awaiting_review=True), "alice")
        assert score_critical > score_awaiting

    def test_combined_bonuses(self):
        # 1 SP, critical, commented => 1/1 * 1.5 * 2.0 = 3.0
        score = confidence_score(
            _make_item(sp=1, priority="critical", user_commented=True),
            "alice",
        )
        assert abs(score - 3.0) < 1e-9

    def test_score_is_float(self):
        score = confidence_score(_make_item(), "alice")
        assert isinstance(score, float)


# ---------------------------------------------------------------------------
# sort_queue_math_test
# ---------------------------------------------------------------------------

class TestSortQueueMathTest:
    def test_sorted_descending_by_score(self):
        items = [
            _make_item(sp=13),     # score = 0.2
            _make_item(sp=1),      # score = 1.0
            _make_item(sp=5),      # score = 0.333
        ]
        # Add dummy titles to tell them apart
        items[0]["title"] = "hard"
        items[1]["title"] = "easy"
        items[2]["title"] = "medium"

        sorted_items = sort_queue_math_test(items, "alice")
        titles = [i["title"] for i in sorted_items]
        assert titles == ["easy", "medium", "hard"]

    def test_empty_list_returns_empty(self):
        assert sort_queue_math_test([], "alice") == []

    def test_original_list_not_mutated(self):
        items = [_make_item(sp=13), _make_item(sp=1)]
        original_order = [id(i) for i in items]
        sort_queue_math_test(items, "alice")
        assert [id(i) for i in items] == original_order

    def test_single_item_returns_single(self):
        items = [_make_item(sp=3)]
        result = sort_queue_math_test(items, "alice")
        assert len(result) == 1


# ---------------------------------------------------------------------------
# recommend_top_three
# ---------------------------------------------------------------------------

class TestRecommendTopThree:
    def _make_queue(self, n: int) -> list[dict]:
        items = []
        for i in range(n):
            item = _make_item(sp=(i % 5) + 1)
            item["title"] = f"Item {i}"
            item["number"] = i
            item["type"] = "issue"
            item["url"] = f"https://github.com/owner/repo/issues/{i}"
            items.append(item)
        return items

    def test_returns_exactly_three_when_enough(self):
        items = self._make_queue(10)
        result = recommend_top_three(items, "alice")
        assert len(result) == 3

    def test_returns_all_when_fewer_than_three(self):
        items = self._make_queue(2)
        result = recommend_top_three(items, "alice")
        assert len(result) == 2

    def test_returns_empty_for_empty_input(self):
        result = recommend_top_three([], "alice")
        assert result == []

    def test_each_result_has_explanation(self):
        items = self._make_queue(5)
        result = recommend_top_three(items, "alice")
        for item in result:
            assert "explanation" in item
            assert isinstance(item["explanation"], str)
            assert len(item["explanation"]) > 0

    def test_each_result_has_score(self):
        items = self._make_queue(5)
        result = recommend_top_three(items, "alice")
        for item in result:
            assert "score" in item
            assert isinstance(item["score"], float)

    def test_results_are_ordered_by_score_descending(self):
        items = self._make_queue(10)
        result = recommend_top_three(items, "alice")
        scores = [item["score"] for item in result]
        assert scores == sorted(scores, reverse=True)

    def test_explanation_contains_recommended_text(self):
        items = self._make_queue(5)
        result = recommend_top_three(items, "alice")
        for item in result:
            assert "Recommended because" in item["explanation"]

    def test_critical_item_appears_in_top_three(self):
        items = self._make_queue(10)
        # Make one item critical with 1 SP — should definitely be in top 3
        items[9]["priority"] = "critical"
        items[9]["story_points"] = 1
        items[9]["title"] = "critical-issue"

        result = recommend_top_three(items, "alice")
        titles = [r["title"] for r in result]
        assert "critical-issue" in titles
