import React, { useEffect, useState, useCallback } from 'react';
import type { ApiClient, Puzzle, PuzzleResult, PuzzleStreak } from '../../services/ApiClient';

interface PuzzlePanelProps {
  apiClient: ApiClient | null;
}

const PUZZLE_TYPE_LABELS: Record<string, string> = {
  debug_snippet: 'Debug Snippet',
  logic_reasoning: 'Logic Reasoning',
  logic: 'Logic',
  sql_regex: 'SQL / Regex',
  algorithm_mini: 'Algorithm Mini',
  algorithm: 'Algorithm',
};

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function formatCountdown(secondsLeft: number): { display: string; isUrgent: boolean } {
  const min = Math.floor(secondsLeft / 60);
  const sec = secondsLeft % 60;
  return {
    display: `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`,
    isUrgent: secondsLeft < 120,
  };
}

export default function PuzzlePanel({ apiClient }: PuzzlePanelProps) {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [streak, setStreak] = useState<PuzzleStreak | null>(null);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<PuzzleResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);

  useEffect(() => {
    if (!apiClient) return;
    setLoading(true);
    Promise.all([apiClient.getTodayPuzzle(), apiClient.getPuzzleStreak()])
      .then(([p, s]) => {
        setPuzzle(p);
        setStreak(s);
        setSecondsLeft(p.timeLimitSeconds);
      })
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [apiClient]);

  // Countdown timer
  useEffect(() => {
    if (!timerRunning || secondsLeft <= 0) return;
    const interval = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          setTimerRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [timerRunning, secondsLeft]);

  const handleStartAttempt = useCallback(() => {
    setTimerRunning(true);
    setStartTime(Date.now());
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!apiClient || !puzzle || !answer.trim() || !startTime) return;
    const timeSeconds = Math.round((Date.now() - startTime) / 1000);
    setSubmitting(true);
    setTimerRunning(false);
    try {
      const res = await apiClient.submitPuzzle(puzzle.date, answer, timeSeconds);
      setResult(res);
      // Refresh streak
      const newStreak = await apiClient.getPuzzleStreak();
      setStreak(newStreak);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [apiClient, puzzle, answer, startTime]);

  if (loading) {
    return (
      <div className="dc-panel">
        <div className="dc-skeleton dc-skeleton--card" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="dc-panel">
        <div className="dc-error">{error}</div>
      </div>
    );
  }

  if (!puzzle) {
    return (
      <div className="dc-panel">
        <div className="dc-empty">No puzzle available — check back tomorrow!</div>
      </div>
    );
  }

  const { display: countdownDisplay, isUrgent } = formatCountdown(secondsLeft);

  return (
    <div className="dc-panel dc-puzzle">
      {/* Streak */}
      {streak && (
        <div className="dc-puzzle__streak">
          <div className="dc-weekly-streak">
            {DAY_LABELS.map((day, i) => (
              <div key={day} className="dc-weekly-streak__day">
                <div
                  className={`dc-weekly-streak__circle${streak.weeklyCompletions[i] ? ' dc-weekly-streak__circle--done' : ''}`}
                />
                <span className="dc-weekly-streak__label">{day}</span>
              </div>
            ))}
          </div>
          <div className="dc-puzzle__streak-count">
            {streak.currentStreak} day streak · {streak.totalCompleted} total
          </div>
        </div>
      )}

      {/* Puzzle header */}
      <div className="dc-puzzle__header">
        <span className={`dc-badge dc-badge--${puzzle.type === 'algorithm_mini' || puzzle.type === 'algorithm' ? 'blue' : puzzle.type === 'debug_snippet' ? 'orange' : 'gray'}`}>
          {PUZZLE_TYPE_LABELS[puzzle.type] ?? puzzle.type}
        </span>
        <h3 className="dc-puzzle__title">{puzzle.title}</h3>
      </div>

      {/* Countdown */}
      <div
        className="dc-puzzle__timer"
        style={{ color: isUrgent ? 'var(--vscode-errorForeground)' : undefined }}
      >
        {countdownDisplay}
        {secondsLeft === 0 && <span className="dc-puzzle__timer-expired"> Time's up!</span>}
      </div>

      {/* Question */}
      <div className="dc-puzzle__question">
        <p>{puzzle.question}</p>
        {puzzle.codeSnippet && (
          <pre className="dc-code-block">
            <code>{puzzle.codeSnippet}</code>
          </pre>
        )}
      </div>

      {/* Result */}
      {result ? (
        <div className={`dc-puzzle__result dc-puzzle__result--${result.correct ? 'correct' : 'incorrect'}`}>
          <div className="dc-puzzle__result-header">
            {result.correct ? '✅ Correct!' : '❌ Not quite'}
            <span className="dc-puzzle__score"> Score: {result.score}/100</span>
            {result.badgeEarned && (
              <span className="dc-badge dc-badge--gold">🏅 {result.badgeEarned}</span>
            )}
          </div>
          <p className="dc-puzzle__feedback">{result.feedback}</p>
          {result.explanation && (
            <details className="dc-puzzle__explanation">
              <summary>Full Explanation</summary>
              <p>{result.explanation}</p>
            </details>
          )}
          {result.badgeEarned && streak && (
            <button
              className="dc-btn dc-btn-ghost dc-btn--sm"
              onClick={async () => {
                if (!apiClient) return;
                // Get Monday of current week
                const now = new Date();
                const day = now.getDay();
                const diff = now.getDate() - day + (day === 0 ? -6 : 1);
                const monday = new Date(now.setDate(diff));
                const weekStart = monday.toISOString().slice(0, 10);
                const url = await apiClient.createStreakGist(weekStart, streak.currentStreak);
                if (url) window.open(url, '_blank');
              }}
            >
              Share on GitHub Gist ↗
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Answer input */}
          {!timerRunning && secondsLeft === puzzle.timeLimitSeconds && (
            <button className="dc-btn dc-btn-primary dc-btn--lg" onClick={handleStartAttempt}>
              Start Attempt (timer begins)
            </button>
          )}

          {(timerRunning || (startTime && secondsLeft < puzzle.timeLimitSeconds)) && (
            <>
              {puzzle.hint && (
                <details className="dc-puzzle__hint">
                  <summary>Hint (costs 10 points)</summary>
                  <p>{puzzle.hint}</p>
                </details>
              )}
              <textarea
                className="dc-textarea dc-puzzle__answer"
                value={answer}
                onChange={e => setAnswer(e.target.value)}
                placeholder={
                  puzzle.language
                    ? `Write your ${puzzle.language} answer here...`
                    : 'Enter your answer...'
                }
                rows={5}
              />
              <button
                className="dc-btn dc-btn-primary"
                onClick={handleSubmit}
                disabled={submitting || !answer.trim()}
              >
                {submitting ? 'Submitting...' : 'Submit Answer'}
              </button>
            </>
          )}

          {!timerRunning && secondsLeft === 0 && (
            <div className="dc-empty">Time expired. Better luck tomorrow!</div>
          )}
        </>
      )}
    </div>
  );
}
