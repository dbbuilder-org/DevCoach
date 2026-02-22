import React, { useCallback } from 'react';
import { usePomodoro } from '../hooks/usePomodoro';

interface PomodoroTimerProps {
  mini?: boolean;
  onPomodoroComplete?: (isBreak: boolean) => void;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

const TOTAL_SECONDS_WORK = 25 * 60;
const TOTAL_SECONDS_BREAK = 5 * 60;

export default function PomodoroTimer({ mini = false, onPomodoroComplete }: PomodoroTimerProps) {
  const handleComplete = useCallback(
    (isBreak: boolean) => {
      onPomodoroComplete?.(isBreak);
    },
    [onPomodoroComplete]
  );

  const { secondsLeft, isRunning, isBreak, pomodoroCount, start, pause, reset, skip } =
    usePomodoro(handleComplete);

  const total = isBreak ? TOTAL_SECONDS_BREAK : TOTAL_SECONDS_WORK;
  const progress = 1 - secondsLeft / total;
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  // SVG ring
  const radius = mini ? 22 : 44;
  const strokeWidth = mini ? 3 : 5;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);
  const viewSize = (radius + strokeWidth) * 2;
  const isUrgent = !isBreak && secondsLeft < 120;

  const ringColor = isUrgent
    ? 'var(--vscode-errorForeground)'
    : isBreak
    ? 'var(--vscode-terminal-ansiGreen)'
    : 'var(--vscode-button-background)';

  if (mini) {
    return (
      <div className="dc-pomodoro dc-pomodoro--mini">
        <svg width={viewSize} height={viewSize} viewBox={`0 0 ${viewSize} ${viewSize}`}>
          <circle
            cx={viewSize / 2}
            cy={viewSize / 2}
            r={radius}
            fill="none"
            stroke="var(--vscode-editorWidget-border)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={viewSize / 2}
            cy={viewSize / 2}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${viewSize / 2} ${viewSize / 2})`}
          />
        </svg>
        <span className="dc-pomodoro__mini-time" style={{ color: isUrgent ? 'var(--vscode-errorForeground)' : undefined }}>
          {pad(minutes)}:{pad(seconds)}
        </span>
        {isRunning ? (
          <button className="dc-btn dc-btn-icon" onClick={pause} title="Pause">⏸</button>
        ) : (
          <button className="dc-btn dc-btn-icon" onClick={start} title="Start">▶</button>
        )}
      </div>
    );
  }

  return (
    <div className="dc-pomodoro">
      <div className="dc-pomodoro__label">
        {isBreak ? 'Break Time' : 'Focus Time'}
      </div>

      <div className="dc-pomodoro__ring-wrap">
        <svg width={viewSize} height={viewSize} viewBox={`0 0 ${viewSize} ${viewSize}`}>
          <circle
            cx={viewSize / 2}
            cy={viewSize / 2}
            r={radius}
            fill="none"
            stroke="var(--vscode-editorWidget-border)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={viewSize / 2}
            cy={viewSize / 2}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${viewSize / 2} ${viewSize / 2})`}
          />
        </svg>
        <div className="dc-pomodoro__time" style={{ color: isUrgent ? 'var(--vscode-errorForeground)' : undefined }}>
          {pad(minutes)}:{pad(seconds)}
        </div>
      </div>

      <div className="dc-pomodoro__controls">
        {isRunning ? (
          <button className="dc-btn dc-btn-secondary" onClick={pause}>Pause</button>
        ) : (
          <button className="dc-btn dc-btn-primary" onClick={start}>
            {secondsLeft === total ? 'Start' : 'Resume'}
          </button>
        )}
        <button className="dc-btn dc-btn-ghost" onClick={reset} title="Reset">Reset</button>
        <button className="dc-btn dc-btn-ghost" onClick={skip} title="Skip">Skip</button>
      </div>

      <div className="dc-pomodoro__count">
        {Array.from({ length: Math.max(pomodoroCount, 4) }, (_, i) => (
          <span key={i} className={i < pomodoroCount ? 'dc-tomato dc-tomato--done' : 'dc-tomato'}>
            🍅
          </span>
        ))}
      </div>
    </div>
  );
}
