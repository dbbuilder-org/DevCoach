import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { ApiClient, Session, WorkBlock, Phase, ProactiveTrigger } from '../../services/ApiClient';
import WorkBlockComponent from './WorkBlock';
import PomodoroTimer from './PomodoroTimer';
import DayClose from './DayClose';

interface TodayPanelProps {
  apiClient: ApiClient | null;
  session: Session | null;
  currentBlock: WorkBlock | null;
  repo: string;
  onSessionChange: (s: Session | null) => void;
  onBlockChange: (b: WorkBlock | null) => void;
  onProactiveTrigger?: (trigger: ProactiveTrigger, context?: Record<string, unknown>) => void;
}

// Timeline segments in a typical dev day (proportional widths, sum to 100)
const TIMELINE_SEGMENTS = [
  { label: 'Warm-up', width: 10, color: 'var(--vscode-terminal-ansiYellow)' },
  { label: 'Block 1', width: 20, color: 'var(--vscode-button-background)' },
  { label: 'Block 2', width: 20, color: 'var(--vscode-button-background)' },
  { label: 'Flex', width: 10, color: 'var(--vscode-terminal-ansiCyan)' },
  { label: 'Block 3', width: 20, color: 'var(--vscode-button-background)' },
  { label: 'Close', width: 20, color: 'var(--vscode-terminal-ansiMagenta)' },
];

function difficultyStars(n: number) {
  return Array.from({ length: 5 }, (_, i) => (
    <span key={i} style={{ opacity: i < n ? 1 : 0.25 }}>⭐</span>
  ));
}

function dayProgressPercent(): number {
  const now = new Date();
  const start = new Date(now);
  start.setHours(9, 0, 0, 0);
  const end = new Date(now);
  end.setHours(17, 0, 0, 0);
  const total = end.getTime() - start.getTime();
  const elapsed = now.getTime() - start.getTime();
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

export default function TodayPanel({
  apiClient,
  session,
  currentBlock,
  repo,
  onSessionChange,
  onBlockChange,
  onProactiveTrigger,
}: TodayPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClose, setShowClose] = useState(false);
  const [progressPct, setProgressPct] = useState(dayProgressPercent());

  const lastActivityRef = useRef<number>(Date.now());
  const coachingLevel: 'peter' | 'ransom' = 'ransom'; // will be enriched later from session

  // Track any user interaction as "activity"
  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  // Update day progress every minute
  useEffect(() => {
    const timer = setInterval(() => setProgressPct(dayProgressPercent()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Stuck detection — check every 2 minutes, fire if threshold exceeded
  useEffect(() => {
    if (!session || !currentBlock) return;
    const threshold = (coachingLevel as string) === 'peter' ? 15 * 60 * 1000 : 10 * 60 * 1000;
    let alreadyFired = false;

    const checkStuck = () => {
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= threshold && !alreadyFired) {
        alreadyFired = true;
        onProactiveTrigger?.('stuck_signal', {
          current_phase: currentBlock.phase,
          current_item: currentBlock.itemRef,
          minutes_idle: Math.floor(idleMs / 60000),
        });
      }
    };

    const interval = setInterval(checkStuck, 2 * 60 * 1000); // check every 2 min
    return () => clearInterval(interval);
  }, [session?.id, currentBlock?.id, onProactiveTrigger]);

  // Load today's session on mount
  useEffect(() => {
    if (!apiClient) return;
    setLoading(true);
    apiClient.getTodaySession()
      .then(s => {
        onSessionChange(s);
        onBlockChange(s?.currentBlock ?? null);
      })
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [apiClient]);

  const handleStartDay = useCallback(async () => {
    if (!apiClient || !repo) return;
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) {
      setError('Set defaultRepo in settings (owner/repo format) before starting.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const s = await apiClient.startSession(owner, repoName);
      onSessionChange(s);
      onBlockChange(s.currentBlock);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiClient, repo, onSessionChange, onBlockChange]);

  const handleNextPhase = useCallback(async (phase: Phase) => {
    if (!apiClient || !session || !currentBlock) return;
    setLoading(true);
    try {
      await apiClient.updateBlockPhase(session.id, currentBlock.id, phase);
      onBlockChange({ ...currentBlock, phase });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiClient, session, currentBlock, onBlockChange]);

  const handleEndBlock = useCallback(async (notes: string) => {
    if (!apiClient || !session || !currentBlock) return;
    setLoading(true);
    try {
      await apiClient.endWorkBlock(session.id, currentBlock.id, notes);
      const updated = await apiClient.getTodaySession();
      onSessionChange(updated);
      onBlockChange(updated?.currentBlock ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiClient, session, currentBlock, onSessionChange, onBlockChange]);

  const handlePomodoroComplete = useCallback((_isBreak: boolean) => {
    if (!_isBreak && session && currentBlock) {
      onProactiveTrigger?.('pomodoro_complete', {
        current_phase: currentBlock.phase,
        current_item: currentBlock.itemRef,
      });
    }
  }, [session, currentBlock, onProactiveTrigger]);

  const handlePhaseTransition = useCallback((trigger: ProactiveTrigger, toPhase: Phase) => {
    if (!session || !currentBlock) return;
    onProactiveTrigger?.(trigger, {
      current_phase: toPhase,
      current_item: currentBlock.itemRef,
    });
  }, [session, currentBlock, onProactiveTrigger]);

  if (showClose && session) {
    return (
      <DayClose
        apiClient={apiClient}
        session={session}
        onEnd={() => {
          onSessionChange(null);
          onBlockChange(null);
          setShowClose(false);
        }}
      />
    );
  }

  return (
    <div className="dc-panel" onClick={recordActivity}>
      {error && <div className="dc-error">{error}</div>}

      {/* Day Timeline */}
      <div className="dc-timeline">
        <div className="dc-timeline__bar">
          {TIMELINE_SEGMENTS.map(seg => (
            <div
              key={seg.label}
              className="dc-timeline__segment"
              style={{ width: `${seg.width}%`, backgroundColor: seg.color }}
              title={seg.label}
            />
          ))}
          {/* Current time indicator */}
          <div
            className="dc-timeline__cursor"
            style={{ left: `${progressPct}%` }}
            title={`${Math.round(progressPct)}% through workday`}
          />
        </div>
        <div className="dc-timeline__labels">
          {TIMELINE_SEGMENTS.map(seg => (
            <div key={seg.label} className="dc-timeline__label" style={{ width: `${seg.width}%` }}>
              {seg.label}
            </div>
          ))}
        </div>
      </div>

      {/* Streak */}
      {session && (
        <div className="dc-streak">
          🔥 <strong>{session.streakDays}</strong> day streak
        </div>
      )}

      {/* No session — prompt to start */}
      {!session && !loading && (
        <div className="dc-start-day">
          <h3>Good morning! Ready to coach you today.</h3>
          <p>Start your day to get your personalized plan and queue.</p>
          <button className="dc-btn dc-btn-primary dc-btn--lg" onClick={handleStartDay}>
            Start My Day
          </button>
        </div>
      )}

      {loading && !session && (
        <div className="dc-skeleton dc-skeleton--card" />
      )}

      {/* Active work block */}
      {session && currentBlock && (
        <WorkBlockComponent
          block={currentBlock}
          onNextPhase={handleNextPhase}
          onEndBlock={handleEndBlock}
          onPhaseTransition={handlePhaseTransition}
          loading={loading}
        />
      )}

      {/* Planned items (no active block) */}
      {session && !currentBlock && session.plannedItems.length > 0 && (
        <div className="dc-planned-items">
          <h4 className="dc-section-title">Today's Plan</h4>
          {session.plannedItems.map(item => (
            <div key={item.id} className="dc-card">
              <div className="dc-card__header">
                <span className={`dc-badge dc-badge--${item.type === 'pr' ? 'orange' : 'blue'}`}>
                  {item.type.toUpperCase()}
                </span>
                <span className="dc-card__sp">{item.storyPoints} SP</span>
              </div>
              <div className="dc-card__title">{item.title}</div>
              <div className="dc-card__meta">
                <span className="dc-stars">{difficultyStars(item.difficulty)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pomodoro + End Day */}
      {session && (
        <div className="dc-today-footer">
          <PomodoroTimer mini onPomodoroComplete={handlePomodoroComplete} />
          <button
            className="dc-btn dc-btn-ghost"
            onClick={() => setShowClose(true)}
          >
            End My Day
          </button>
        </div>
      )}
    </div>
  );
}
