import React, { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { ApiClient, VelocityData, CoachingSignals } from '../../services/ApiClient';

interface ChartsPanelProps {
  apiClient: ApiClient | null;
}

interface PhaseBalance {
  phase: string;
  totalMinutes: number;
  blockCount: number;
}

// Format YYYY-MM-DD to short label like "Mon 17"
function dateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric' });
}

// Streak calendar: last 30 days
function last30Days(): string[] {
  const dates: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

interface ProgressBarProps {
  label: string;
  value: number;  // 0-1
  goodThreshold: number;  // 0-1 — above this is "good"
  inverted?: boolean;     // true means lower is better
  formatValue?: (v: number) => string;
}

function ProgressBar({ label, value, goodThreshold, inverted = false, formatValue }: ProgressBarProps) {
  const isGood = inverted ? value <= goodThreshold : value >= goodThreshold;
  const pct = Math.min(100, Math.round(value * 100));
  const color = isGood ? 'var(--vscode-terminal-ansiGreen)' : 'var(--vscode-terminal-ansiYellow)';
  const displayValue = formatValue ? formatValue(value) : `${pct}%`;

  return (
    <div className="dc-progress-row">
      <div className="dc-progress-label">
        <span>{label}</span>
        <span style={{ color }} className="dc-progress-value">{displayValue}</span>
      </div>
      <div className="dc-progress-track">
        <div className="dc-progress-fill" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <div className="dc-progress-status" style={{ color }}>
        {isGood ? '✓ Good' : '· Needs work'}
      </div>
    </div>
  );
}

const PHASE_COLORS: Record<string, string> = {
  understand: 'var(--vscode-terminal-ansiYellow)',
  address: 'var(--vscode-button-background)',
  test: 'var(--vscode-terminal-ansiGreen)',
  pr: 'var(--vscode-terminal-ansiCyan)',
  annotate: 'var(--vscode-terminal-ansiMagenta)',
};

export default function ChartsPanel({ apiClient }: ChartsPanelProps) {
  const [velocity, setVelocity] = useState<VelocityData[]>([]);
  const [signals, setSignals] = useState<CoachingSignals | null>(null);
  const [phaseBalance, setPhaseBalance] = useState<PhaseBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiClient) return;
    setLoading(true);
    Promise.all([
      apiClient.getVelocity(14),
      apiClient.getCoachingSignals(),
      apiClient.getPhaseBalance(),
    ])
      .then(([vel, sig, balance]) => {
        setVelocity(vel);
        setSignals(sig);
        setPhaseBalance(balance);
      })
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [apiClient]);

  const calendarDays = last30Days();
  // A day is "green" if it has velocity data with at least 1 PR merged
  const velocityByDate = new Map(velocity.map(v => [v.date, v]));

  if (loading) {
    return (
      <div className="dc-panel">
        <div className="dc-skeleton dc-skeleton--chart" />
        <div className="dc-skeleton dc-skeleton--chart" />
      </div>
    );
  }

  return (
    <div className="dc-panel">
      {error && <div className="dc-error">{error}</div>}

      {/* Velocity chart */}
      <section className="dc-chart-section">
        <h4 className="dc-section-title">Velocity — Last 14 Days</h4>
        {velocity.length === 0 ? (
          <div className="dc-empty">No data yet — complete some work blocks to see velocity.</div>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={velocity.map(v => ({ ...v, date: dateLabel(v.date) }))} barSize={10} barGap={2}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--vscode-editor-foreground)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--vscode-editor-foreground)' }} tickLine={false} axisLine={false} width={20} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--vscode-editorWidget-background)',
                  border: '1px solid var(--vscode-editorWidget-border)',
                  color: 'var(--vscode-editor-foreground)',
                  fontSize: 11,
                }}
              />
              <Bar dataKey="prsMerged" name="PRs Merged" fill="var(--vscode-button-background)" radius={[2, 2, 0, 0]} />
              <Bar dataKey="prsReviewed" name="Reviewed" fill="var(--vscode-terminal-ansiCyan)" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
        <div className="dc-chart-legend">
          <span className="dc-legend-dot" style={{ background: 'var(--vscode-button-background)' }} /> PRs Merged
          <span className="dc-legend-dot" style={{ background: 'var(--vscode-terminal-ansiCyan)' }} /> Reviewed
        </div>
      </section>

      {/* Streak calendar */}
      <section className="dc-chart-section">
        <h4 className="dc-section-title">Streak — Last 30 Days</h4>
        <div className="dc-calendar">
          {calendarDays.map(date => {
            const v = velocityByDate.get(date);
            const active = v && v.prsMerged > 0;
            return (
              <div
                key={date}
                className={`dc-calendar__day${active ? ' dc-calendar__day--active' : ''}`}
                title={date}
              />
            );
          })}
        </div>
      </section>

      {/* Phase Balance */}
      {phaseBalance.length > 0 && (
        <section className="dc-chart-section">
          <h4 className="dc-section-title">Time per Phase (All Time)</h4>
          <div className="dc-phase-balance">
            {phaseBalance.map(pb => {
              const totalMins = phaseBalance.reduce((sum, p) => sum + p.totalMinutes, 0);
              const pct = totalMins > 0 ? Math.round((pb.totalMinutes / totalMins) * 100) : 0;
              const color = PHASE_COLORS[pb.phase] ?? 'var(--vscode-editor-foreground)';
              return (
                <div key={pb.phase} className="dc-phase-row">
                  <span className="dc-phase-row__label" style={{ color }}>
                    {pb.phase}
                  </span>
                  <div className="dc-progress-track dc-phase-row__track">
                    <div
                      className="dc-progress-fill"
                      style={{ width: `${pct}%`, backgroundColor: color }}
                    />
                  </div>
                  <span className="dc-phase-row__pct">{pct}%</span>
                  <span className="dc-phase-row__time">{Math.round(pb.totalMinutes)}m</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Coaching signals */}
      {signals && (
        <section className="dc-chart-section">
          <h4 className="dc-section-title">Coaching Signals</h4>
          <ProgressBar
            label="Annotation Rate"
            value={signals.annotationRate}
            goodThreshold={0.7}
            formatValue={v => `${Math.round(v * 100)}%`}
          />
          <ProgressBar
            label="Review Latency"
            value={Math.min(signals.reviewLatencyHours / 48, 1)}
            goodThreshold={0.5}
            inverted
            formatValue={() => `${Math.round(signals.reviewLatencyHours)}h avg`}
          />
          <ProgressBar
            label="Focus Score"
            value={signals.focusScore}
            goodThreshold={0.6}
            formatValue={v => `${Math.round(v * 100)}%`}
          />
          <ProgressBar
            label="Consistency"
            value={signals.consistencyScore}
            goodThreshold={0.7}
            formatValue={v => `${Math.round(v * 100)}%`}
          />

          {signals.recommendations.length > 0 && (
            <div className="dc-recommendations">
              <h5 className="dc-section-title dc-section-title--sm">Coach Recommendations</h5>
              <ul className="dc-recs-list">
                {signals.recommendations.map((rec, i) => (
                  <li key={i} className="dc-rec-item">💡 {rec}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
