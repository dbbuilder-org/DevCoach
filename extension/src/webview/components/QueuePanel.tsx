import React, { useEffect, useState, useCallback } from 'react';
import type { ApiClient, QueueItem, Session, RepoHealth } from '../../services/ApiClient';

interface QueuePanelProps {
  apiClient: ApiClient | null;
  session: Session | null;
  repo: string;
  onStartBlock: (item: QueueItem) => void;
}

type Filter = 'all' | 'issues' | 'prs' | 'mine' | 'review';

function difficultyStars(n: number) {
  return Array.from({ length: 5 }, (_, i) => (
    <span key={i} style={{ opacity: i < n ? 1 : 0.2 }}>⭐</span>
  ));
}

function ageLabel(hours: number): string {
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

interface HygieneSectionProps {
  title: string;
  icon: string;
  items: QueueItem[];
  emptyMessage: string;
  defaultExpanded?: boolean;
}

function HygieneSection({ title, icon, items, emptyMessage, defaultExpanded = false }: HygieneSectionProps) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);

  return (
    <div className="dc-hygiene-section">
      <button
        className="dc-hygiene-section__header"
        onClick={() => setExpanded(e => !e)}
      >
        <span className="dc-hygiene-section__icon">{icon}</span>
        <span className="dc-hygiene-section__title">{title}</span>
        <span className={`dc-badge ${items.length > 0 ? 'dc-badge--orange' : 'dc-badge--gray'}`}>
          {items.length}
        </span>
        <span className="dc-hygiene-section__chevron">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="dc-hygiene-section__body">
          {items.length === 0 ? (
            <div className="dc-hygiene-empty">{emptyMessage} ✓</div>
          ) : (
            items.map(item => (
              <div key={item.id} className="dc-hygiene-item">
                <span className={`dc-badge dc-badge--${item.type === 'pr' ? 'orange' : 'blue'} dc-badge--xs`}>
                  {item.type.toUpperCase()} #{item.id}
                </span>
                <a href={item.url} target="_blank" rel="noreferrer" className="dc-hygiene-item__title">
                  {item.title}
                </a>
                {item.storyPoints && (
                  <span className="dc-muted dc-hygiene-item__sp">{item.storyPoints}SP</span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function QueuePanel({ apiClient, session, repo, onStartBlock }: QueuePanelProps) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [health, setHealth] = useState<RepoHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const loadQueue = useCallback(async () => {
    if (!apiClient || !repo) return;
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) return;

    setLoading(true);
    setError(null);
    try {
      const recommendations = await apiClient.getRecommendations(owner, repoName);
      setItems(recommendations);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiClient, repo]);

  const loadHealth = useCallback(async () => {
    if (!apiClient || !repo) return;
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) return;
    setHealthLoading(true);
    try {
      const h = await apiClient.getRepoHealth(owner, repoName);
      setHealth(h);
    } catch {
      // health is best-effort
    } finally {
      setHealthLoading(false);
    }
  }, [apiClient, repo]);

  useEffect(() => {
    loadQueue();
    loadHealth();
  }, [loadQueue, loadHealth]);

  const filtered = items.filter(item => {
    switch (filter) {
      case 'issues': return item.type === 'issue';
      case 'prs': return item.type === 'pr';
      case 'mine': return item.assignedToMe;
      case 'review': return item.needsReview;
      default: return true;
    }
  });

  function itemBadgeClass(item: QueueItem): string {
    if (item.assignedToMe) return 'dc-badge--blue';
    if (item.needsReview) return 'dc-badge--orange';
    return 'dc-badge--gray';
  }

  function itemCardClass(item: QueueItem): string {
    if (item.assignedToMe) return 'dc-card dc-card--assigned';
    if (item.needsReview) return 'dc-card dc-card--review';
    return 'dc-card';
  }

  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'issues', label: 'Issues' },
    { id: 'prs', label: 'PRs' },
    { id: 'mine', label: 'Mine' },
    { id: 'review', label: 'Review' },
  ];

  return (
    <div className="dc-panel">
      <div className="dc-panel__header">
        <h4 className="dc-section-title">Work Queue</h4>
        <button className="dc-btn dc-btn-ghost dc-btn--sm" onClick={() => { loadQueue(); loadHealth(); }} disabled={loading}>
          ↺ Refresh
        </button>
      </div>

      {repo && (
        <div className="dc-queue-meta">
          Sorted by confidence — easiest to tackle first
        </div>
      )}

      {!repo && (
        <div className="dc-empty">
          <p>Set <code>devcoach.defaultRepo</code> in VS Code settings to see your queue.</p>
        </div>
      )}

      {error && <div className="dc-error">{error}</div>}

      {/* Repo Hygiene */}
      {health && (
        <div className="dc-hygiene">
          <div className="dc-hygiene__header">
            <span className="dc-hygiene__label">
              {health.totalHygieneIssues > 0
                ? `⚠️ ${health.totalHygieneIssues} hygiene issue${health.totalHygieneIssues !== 1 ? 's' : ''}`
                : '✅ Repo hygiene clean'}
            </span>
          </div>
          <HygieneSection
            title="Issues without PRs"
            icon="🔴"
            items={health.issuesWithoutPrs}
            emptyMessage="All assigned issues have linked PRs"
            defaultExpanded={health.issuesWithoutPrs.length > 0}
          />
          <HygieneSection
            title="PRs without issues"
            icon="🟡"
            items={health.prsWithoutIssues}
            emptyMessage="All open PRs reference an issue"
          />
          <HygieneSection
            title="Awaiting your review"
            icon="🔵"
            items={health.prsAwaitingReview}
            emptyMessage="No PRs waiting on your review"
            defaultExpanded={health.prsAwaitingReview.length > 0}
          />
          <HygieneSection
            title="Stale issues (7+ days)"
            icon="⏱️"
            items={health.staleIssues}
            emptyMessage="No stale issues"
          />
        </div>
      )}
      {healthLoading && !health && (
        <div className="dc-skeleton dc-skeleton--card" />
      )}

      {/* Filter row */}
      <div className="dc-filter-row">
        {FILTERS.map(f => (
          <button
            key={f.id}
            className={`dc-filter-btn${filter === f.id ? ' dc-filter-btn--active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Skeletons while loading */}
      {loading && (
        <>
          <div className="dc-skeleton dc-skeleton--card" />
          <div className="dc-skeleton dc-skeleton--card" />
          <div className="dc-skeleton dc-skeleton--card" />
        </>
      )}

      {/* Items */}
      {!loading && filtered.length === 0 && repo && (
        <div className="dc-empty">No items match this filter.</div>
      )}

      {!loading && filtered.map(item => (
        <div key={item.id} className={itemCardClass(item)}>
          <div className="dc-card__header">
            <span className={`dc-badge ${itemBadgeClass(item)}`}>
              {item.type.toUpperCase()}
            </span>
            {item.assignedToMe && <span className="dc-badge dc-badge--blue">Mine</span>}
            {item.needsReview && <span className="dc-badge dc-badge--orange">Review</span>}
            <span className="dc-card__age">{ageLabel(item.ageHours)} old</span>
            <span className="dc-card__sp">{item.storyPoints} SP</span>
          </div>

          <div className="dc-card__title">{item.title}</div>

          <div className="dc-card__meta">
            <span className="dc-stars">{difficultyStars(item.difficulty)}</span>
            {item.labels.length > 0 && (
              <span className="dc-card__labels">
                {item.labels.slice(0, 3).map(label => (
                  <span key={label} className="dc-label-pill">{label}</span>
                ))}
              </span>
            )}
          </div>

          <div className="dc-card__actions">
            {session ? (
              <button
                className="dc-btn dc-btn-primary dc-btn--sm"
                onClick={() => onStartBlock(item)}
              >
                Start this →
              </button>
            ) : (
              <span className="dc-muted">Start your day first</span>
            )}
            <a
              className="dc-btn dc-btn-ghost dc-btn--sm"
              href={item.url}
              target="_blank"
              rel="noreferrer"
            >
              View ↗
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}
