import React, { useState, useEffect } from 'react';
import type { WorkBlock as WorkBlockType, Phase, ProactiveTrigger } from '../../services/ApiClient';

interface WorkBlockProps {
  block: WorkBlockType;
  onNextPhase: (nextPhase: Phase) => void;
  onEndBlock: (notes: string) => void;
  onPhaseTransition?: (trigger: ProactiveTrigger, toPhase: Phase) => void;
  loading?: boolean;
}

const PHASES: Phase[] = ['understand', 'address', 'test', 'pr', 'annotate'];

const PHASE_INFO: Record<Phase, { label: string; description: string; tip: string; emoji: string }> = {
  understand: {
    label: 'Understand',
    emoji: '🔍',
    description: 'Read the issue, explore the code, ask AI questions',
    tip: 'Spend time here — rushing past understanding causes rework.',
  },
  address: {
    label: 'Address',
    emoji: '⚡',
    description: 'Implement the fix (Pomodoro active)',
    tip: 'Close Slack. One task at a time. Let the timer protect your focus.',
  },
  test: {
    label: 'Test',
    emoji: '✅',
    description: 'Run tests, check browser, verify fix',
    tip: 'Test the unhappy path too — edge cases bite in production.',
  },
  pr: {
    label: 'PR',
    emoji: '📬',
    description: 'Create PR, check CI, request review',
    tip: 'Write a clear PR description — future-you will thank you.',
  },
  annotate: {
    label: 'Annotate',
    emoji: '📝',
    description: 'Comment on issue, update journal',
    tip: "Closing the loop takes 2 minutes and builds your team's trust.",
  },
};

function elapsed(isoStart: string): string {
  const diffMs = Date.now() - new Date(isoStart).getTime();
  const totalSec = Math.floor(diffMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

export default function WorkBlockComponent({ block, onNextPhase, onEndBlock, onPhaseTransition, loading }: WorkBlockProps) {
  const [notes, setNotes] = useState(block.notes ?? '');
  const [elapsedDisplay, setElapsedDisplay] = useState(elapsed(block.startedAt));

  // Derive display fields from itemRef
  const itemTitle = (block.itemRef.title as string) ?? 'Untitled';
  const itemType = (block.itemRef.type as string) ?? 'issue';

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedDisplay(elapsed(block.startedAt));
    }, 1000);
    return () => clearInterval(timer);
  }, [block.startedAt]);

  const currentPhaseIndex = PHASES.indexOf(block.phase);
  const isLastPhase = currentPhaseIndex === PHASES.length - 1;
  const nextPhase = isLastPhase ? null : PHASES[currentPhaseIndex + 1];
  const info = PHASE_INFO[block.phase];

  return (
    <div className="dc-workblock">
      <div className="dc-workblock__header">
        <span className="dc-badge dc-badge--blue">{itemType.toUpperCase()}</span>
        <span className="dc-workblock__title">{itemTitle}</span>
      </div>

      {/* Phase stepper */}
      <div className="dc-stepper">
        {PHASES.map((phase, idx) => {
          const phaseInfo = PHASE_INFO[phase];
          const isDone = idx < currentPhaseIndex;
          const isCurrent = idx === currentPhaseIndex;
          return (
            <React.Fragment key={phase}>
              <div
                className={`dc-stepper__step${isCurrent ? ' dc-stepper__step--active' : ''}${isDone ? ' dc-stepper__step--done' : ''}`}
              >
                <div className="dc-stepper__dot">
                  {isDone ? '✓' : phaseInfo.emoji}
                </div>
                <div className="dc-stepper__label">{phaseInfo.label}</div>
              </div>
              {idx < PHASES.length - 1 && (
                <div className={`dc-stepper__line${isDone ? ' dc-stepper__line--done' : ''}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Current phase detail */}
      <div className="dc-workblock__phase-detail">
        <div className="dc-workblock__phase-name">
          {info.emoji} {info.label}
          <span className="dc-workblock__elapsed"> · {elapsedDisplay}</span>
        </div>
        <p className="dc-workblock__phase-desc">{info.description}</p>
        <div className="dc-coach-tip">💡 {info.tip}</div>
      </div>

      {/* Notes */}
      <div className="dc-workblock__notes">
        <label className="dc-label">Notes</label>
        <textarea
          className="dc-textarea"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Jot anything down — observations, blockers, ideas..."
          rows={3}
        />
      </div>

      {/* Actions */}
      <div className="dc-workblock__actions">
        {nextPhase && (
          <button
            className="dc-btn dc-btn-primary"
            onClick={() => {
              onNextPhase(nextPhase);
              // Fire special triggers for high-value phase transitions
              if (nextPhase === 'pr') {
                onPhaseTransition?.('pre_merge', nextPhase);
              } else if (nextPhase === 'annotate') {
                onPhaseTransition?.('phase_transition', nextPhase);
              } else {
                onPhaseTransition?.('phase_transition', nextPhase);
              }
            }}
            disabled={loading}
          >
            Next: {PHASE_INFO[nextPhase].label} →
          </button>
        )}
        {isLastPhase && (
          <button
            className="dc-btn dc-btn-primary"
            onClick={() => onEndBlock(notes)}
            disabled={loading}
          >
            Complete Block ✓
          </button>
        )}
        <button
          className="dc-btn dc-btn-ghost"
          onClick={() => onEndBlock(notes)}
          disabled={loading}
        >
          End Early
        </button>
      </div>
    </div>
  );
}
