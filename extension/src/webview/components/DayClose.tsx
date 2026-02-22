import React, { useEffect, useState, useCallback } from 'react';
import type { ApiClient, Session, DaySummary } from '../../services/ApiClient';

interface DayCloseProps {
  apiClient: ApiClient | null;
  session: Session;
  onEnd: () => void;
}

export default function DayClose({ apiClient, session, onEnd }: DayCloseProps) {
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Prefetch partial summary stats from the session itself
  const prsMerged = 0;   // Would come from analytics in a full impl
  const blocksCompleted = session.workBlocks.filter(b => b.endedAt !== null).length;

  const handleEndDay = useCallback(async () => {
    if (!apiClient) return;
    setEnding(true);
    setError(null);
    try {
      const result = await apiClient.endSession(session.id, feedback);
      setSummary(result);
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnding(false);
    }
  }, [apiClient, session.id, feedback]);

  if (done && summary) {
    return (
      <div className="dc-panel dc-day-close dc-day-close--done">
        <div className="dc-day-close__closing-message">
          {summary.encouragement}
        </div>

        <div className="dc-day-close__stats">
          <div className="dc-stat">
            <div className="dc-stat__value">{summary.prsMerged}</div>
            <div className="dc-stat__label">PRs Merged</div>
          </div>
          <div className="dc-stat">
            <div className="dc-stat__value">{summary.prsReviewed}</div>
            <div className="dc-stat__label">Reviewed</div>
          </div>
          <div className="dc-stat">
            <div className="dc-stat__value">{summary.issuesAnnotated}</div>
            <div className="dc-stat__label">Annotated</div>
          </div>
          <div className="dc-stat">
            <div className="dc-stat__value">{summary.blocksCompleted}</div>
            <div className="dc-stat__label">Blocks Done</div>
          </div>
        </div>

        <div className="dc-day-close__velocity">
          Velocity vs 7-day avg:{' '}
          <strong style={{ color: summary.velocityVsAverage >= 1 ? 'var(--vscode-terminal-ansiGreen)' : 'var(--vscode-terminal-ansiYellow)' }}>
            {summary.velocityVsAverage >= 1 ? '+' : ''}{Math.round((summary.velocityVsAverage - 1) * 100)}%
          </strong>
        </div>

        {summary.puzzleCompleted && (
          <div className="dc-badge dc-badge--gold">🏅 Puzzle completed today!</div>
        )}

        <div className="dc-day-close__reflection">
          <h5>Today's reflection</h5>
          <p>{summary.reflection}</p>
        </div>

        <div className="dc-day-close__journal-confirm">
          Journal entry written. See you tomorrow!
        </div>

        <button className="dc-btn dc-btn-ghost" onClick={onEnd}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="dc-panel dc-day-close">
      <h3 className="dc-day-close__title">Wrap Up Your Day</h3>

      {error && <div className="dc-error">{error}</div>}

      {/* Quick stats */}
      <div className="dc-day-close__stats">
        <div className="dc-stat">
          <div className="dc-stat__value">{blocksCompleted}</div>
          <div className="dc-stat__label">Blocks Done</div>
        </div>
        <div className="dc-stat">
          <div className="dc-stat__value">{session.workBlocks.length}</div>
          <div className="dc-stat__label">Total Blocks</div>
        </div>
      </div>

      {/* Reflection question */}
      <div className="dc-day-close__reflection-q">
        <label className="dc-label">
          How did today go? Any blockers, wins, or things you'd do differently?
        </label>
        <textarea
          className="dc-textarea"
          value={feedback}
          onChange={e => setFeedback(e.target.value)}
          placeholder="Optional — your reflection helps the AI coach you better tomorrow."
          rows={4}
        />
      </div>

      <div className="dc-day-close__actions">
        <button
          className="dc-btn dc-btn-primary dc-btn--lg"
          onClick={handleEndDay}
          disabled={ending}
        >
          {ending ? 'Saving...' : 'End My Day'}
        </button>
        <button className="dc-btn dc-btn-ghost" onClick={onEnd}>
          Cancel
        </button>
      </div>
    </div>
  );
}
