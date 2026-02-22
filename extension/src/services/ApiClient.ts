// ─── Domain Types ────────────────────────────────────────────────────────────

export type Phase = 'understand' | 'address' | 'test' | 'pr' | 'annotate';

export type ItemType = 'issue' | 'pr';

export type ProactiveTrigger =
  | 'phase_transition'
  | 'stuck'
  | 'pomodoro_break'
  | 'pre_merge'
  | 'day_end'
  | 'puzzle_complete'
  | 'pomodoro_complete'
  | 'phase_change'
  | 'stuck_signal'
  | 'day_start';

export interface QueueItem {
  id: number;          // maps from backend `number` field
  type: 'issue' | 'pr'; // backend returns 'issue' or 'pull_request' — normalize to 'pr'
  title: string;
  url: string;
  difficulty: number;      // 1-5, computed from story_points tier
  storyPoints: number | null;
  assignedToMe: boolean;
  needsReview: boolean;
  ageHours: number;        // compute from created_at if available, else 0
  confidenceScore: number; // maps from `score`
  labels: string[];
  priority: string;
  explanation: string | null;
}

export interface WorkBlock {
  id: string;
  sessionId: string;
  itemRef: Record<string, unknown>; // raw item_ref from backend
  phase: Phase;
  startedAt: string;
  endedAt: string | null;
  prUrl: string | null;
  annotated: boolean;
  notes: string | null;
}

export interface Session {
  id: string;
  date: string;
  owner: string | null;
  repo: string | null;
  startedAt: string | null;
  endedAt: string | null;
  plannedItems: QueueItem[];
  workBlocks: WorkBlock[];
  currentBlock: WorkBlock | null;
  streakDays: number;
  journalSnippet: string;
  recommendations: QueueItem[] | null;
}

export interface DaySummary {
  sessionId: string;
  date: string;
  prsMerged: number;
  prsReviewed: number;
  issuesAnnotated: number;
  blocksCompleted: number;
  totalMinutes: number;
  puzzleCompleted: boolean;
  velocityVsAverage: number;
  reflection: string;
  encouragement: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;          // ISO
  trigger?: ProactiveTrigger;
}

export interface ChatContext {
  currentItem?: QueueItem;
  currentPhase?: Phase;
  recentBlockNotes?: string;
}

export interface Puzzle {
  date: string;               // puzzle_date from backend
  type: string;               // puzzle_type: 'debug_snippet' | 'logic_reasoning' | 'sql_regex' | 'algorithm_mini'
  title: string;              // derived from type — no backend field
  question: string;
  hint: string;
  timeLimitSeconds: number;   // always 900 (15 min) — not from backend
  completed: boolean;
  codeSnippet?: string;       // optional, parsed from question if it contains a code block
  language?: string;
}

export interface PuzzleResult {
  correct: boolean;
  score: number;              // 0-100 (adapted from backend's 0.0-1.0)
  timeSeconds: number;        // NOT from backend — caller stores this locally
  feedback: string;
  explanation: string;        // now returned by backend
  withinLimit: boolean;       // maps from within_limit
  badgeEarned?: string;       // from badge_earned.badge_type if present
}

export interface PuzzleStreak {
  currentStreak: number;      // maps from days_completed
  longestStreak: number;      // not tracked by backend — same as currentStreak for now
  weeklyCompletions: boolean[]; // [Mon, Tue, Wed, Thu, Fri] — from weekly_completions
  totalCompleted: number;     // maps from total_completed
  badges: Array<{badge_type: string; earned_at: string}>;
}

export interface VelocityData {
  date: string;               // YYYY-MM-DD
  prsMerged: number;
  prsReviewed: number;
  issuesAnnotated: number;
  minutesWorked: number;
}

export interface CoachingSignals {
  annotationRate: number;     // 0-1
  reviewLatencyHours: number;
  focusScore: number;         // 0-1 (time in address phase / total block time)
  consistencyScore: number;   // 0-1 (streak regularity)
  recommendations: string[];
}

export interface RepoHealth {
  issuesWithoutPrs: QueueItem[];
  prsWithoutIssues: QueueItem[];
  prsAwaitingReview: QueueItem[];
  staleIssues: QueueItem[];
  totalHygieneIssues: number;
}

// ─── API Client ──────────────────────────────────────────────────────────────

export class ApiClient {
  private readonly tokenGetter: () => Promise<string>;

  constructor(
    private readonly baseUrl: string,
    /** Static PAT string (VS Code extension) or async getter (web app with Clerk JWT). */
    tokenOrGetter: string | (() => Promise<string | null>),
    private readonly anthropicKey?: string
  ) {
    if (typeof tokenOrGetter === 'string') {
      this.tokenGetter = async () => tokenOrGetter;
    } else {
      this.tokenGetter = async () => (await tokenOrGetter()) ?? '';
    }
  }

  // ─── Response Adapters ───────────────────────────────────────────────────

  private adaptQueueItem(raw: Record<string, unknown>): QueueItem {
    // Normalize type: 'pull_request' -> 'pr'
    const rawType = raw.type as string;
    const type: 'issue' | 'pr' = rawType === 'pull_request' ? 'pr' : 'issue';

    // Compute difficulty tier from story_points
    const sp = raw.story_points as number | null;
    let difficulty = 3;
    if (sp !== null && sp !== undefined) {
      if (sp <= 2) difficulty = 1;
      else if (sp <= 4) difficulty = 2;
      else if (sp <= 7) difficulty = 3;
      else if (sp <= 12) difficulty = 4;
      else difficulty = 5;
    }

    // Compute age from created_at
    let ageHours = 0;
    if (raw.created_at) {
      const created = new Date(raw.created_at as string);
      ageHours = (Date.now() - created.getTime()) / (1000 * 60 * 60);
    }

    return {
      id: raw.number as number,
      type,
      title: raw.title as string,
      url: raw.url as string,
      difficulty,
      storyPoints: sp ?? null,
      assignedToMe: Boolean(raw.is_assigned_to_user),
      needsReview: Boolean(raw.awaiting_review_from_user),
      ageHours,
      confidenceScore: (raw.score as number) ?? 0,
      labels: (raw.labels as string[]) ?? [],
      priority: (raw.priority as string) ?? 'normal',
      explanation: (raw.explanation as string) ?? null,
    };
  }

  private adaptWorkBlock(raw: Record<string, unknown>): WorkBlock {
    return {
      id: raw.id as string,
      sessionId: raw.session_id as string,
      itemRef: (raw.item_ref as Record<string, unknown>) ?? {},
      phase: (raw.phase as Phase) ?? 'understand',
      startedAt: raw.started_at as string,
      endedAt: (raw.ended_at as string) ?? null,
      prUrl: (raw.pr_url as string) ?? null,
      annotated: Boolean(raw.annotated),
      notes: (raw.notes as string) ?? null,
    };
  }

  private adaptSession(raw: Record<string, unknown>): Session {
    const rawBlocks = (raw.work_blocks as Record<string, unknown>[]) ?? [];
    const rawCurrentBlock = raw.current_block as Record<string, unknown> | null;
    const rawRecommendations = raw.recommendations as Record<string, unknown>[] | null;
    const rawPlannedItems = raw.planned_items as Record<string, unknown>[] | null;

    return {
      id: raw.id as string,
      date: raw.date as string,
      owner: (raw.owner as string) ?? null,
      repo: (raw.repo as string) ?? null,
      startedAt: (raw.started_at as string) ?? null,
      endedAt: (raw.ended_at as string) ?? null,
      plannedItems: (rawPlannedItems ?? []).map(i => this.adaptQueueItem(i)),
      workBlocks: rawBlocks.map(b => this.adaptWorkBlock(b)),
      currentBlock: rawCurrentBlock ? this.adaptWorkBlock(rawCurrentBlock) : null,
      streakDays: (raw.streak_days as number) ?? 0,
      journalSnippet: (raw.journal_snippet as string) ?? '',
      recommendations: rawRecommendations ? rawRecommendations.map(i => this.adaptQueueItem(i)) : null,
    };
  }

  private adaptDaySummary(raw: Record<string, unknown>): DaySummary {
    return {
      sessionId: raw.session_id as string,
      date: raw.date as string,
      prsMerged: (raw.prs_merged as number) ?? 0,
      prsReviewed: (raw.prs_reviewed as number) ?? 0,
      issuesAnnotated: (raw.issues_annotated as number) ?? 0,
      blocksCompleted: (raw.blocks_completed as number) ?? 0,
      totalMinutes: (raw.total_minutes as number) ?? 0,
      puzzleCompleted: Boolean(raw.puzzle_completed),
      velocityVsAverage: (raw.velocity_vs_average as number) ?? 1.0,
      reflection: (raw.reflection as string) ?? '',
      encouragement: (raw.encouragement as string) ?? 'Great work today!',
    };
  }

  private adaptPuzzle(raw: Record<string, unknown>): Puzzle {
    const typeLabels: Record<string, string> = {
      debug_snippet: 'Debug Snippet',
      logic_reasoning: 'Logic Reasoning',
      sql_regex: 'SQL / Regex',
      algorithm_mini: 'Algorithm Mini',
    };
    const puzzleType = raw.puzzle_type as string || raw.type as string || 'logic_reasoning';
    return {
      date: raw.puzzle_date as string,
      type: puzzleType,
      title: typeLabels[puzzleType] ?? puzzleType,
      question: raw.question as string ?? '',
      hint: (raw.hint as string) ?? '',
      timeLimitSeconds: 900,
      completed: Boolean(raw.completed),
    };
  }

  private adaptPuzzleResult(raw: Record<string, unknown>, timeSeconds: number): PuzzleResult {
    const badgeEarned = raw.badge_earned as Record<string, unknown> | null;
    return {
      correct: Boolean(raw.correct),
      score: Math.round((raw.score as number) * 100),
      timeSeconds,
      feedback: raw.feedback as string ?? '',
      explanation: (raw.explanation as string) ?? '',
      withinLimit: Boolean(raw.within_limit),
      badgeEarned: badgeEarned?.badge_type as string | undefined,
    };
  }

  private adaptPuzzleStreak(raw: Record<string, unknown>): PuzzleStreak {
    const weeklyCompletions = raw.weekly_completions as boolean[] | undefined;
    const daysCompleted = (raw.days_completed as number) ?? 0;
    return {
      currentStreak: daysCompleted,
      longestStreak: daysCompleted,
      weeklyCompletions: weeklyCompletions ?? Array(5).fill(false),
      totalCompleted: (raw.total_completed as number) ?? daysCompleted,
      badges: (raw.badges as Array<{badge_type: string; earned_at: string}>) ?? [],
    };
  }

  // ─── Sessions ────────────────────────────────────────────────────────────

  async startSession(owner: string, repo: string): Promise<Session> {
    const raw = await this.request<Record<string, unknown>>('POST', '/sessions/start', { owner, repo });
    return this.adaptSession(raw);
  }

  async endSession(sessionId: string, feedback: string): Promise<DaySummary> {
    const raw = await this.request<Record<string, unknown>>('POST', `/sessions/${sessionId}/end`, {
      day_feedback: feedback,
      write_journal: true,
    });
    return this.adaptDaySummary(raw);
  }

  async getTodaySession(): Promise<Session | null> {
    try {
      const raw = await this.request<Record<string, unknown>>('GET', '/sessions/today');
      return this.adaptSession(raw);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }

  // ─── Queue ───────────────────────────────────────────────────────────────

  async getQueue(owner: string, repo: string): Promise<QueueItem[]> {
    const raws = await this.request<Record<string, unknown>[]>(
      'GET', `/github/queue?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`
    );
    return raws.map(r => this.adaptQueueItem(r));
  }

  async getRecommendations(owner: string, repo: string): Promise<QueueItem[]> {
    const raws = await this.request<Record<string, unknown>[]>(
      'GET', `/github/queue/recommendations?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`
    );
    return raws.map(r => this.adaptQueueItem(r));
  }

  async getRepoHealth(owner: string, repo: string): Promise<RepoHealth> {
    const raw = await this.request<{
      issues_without_prs: Record<string, unknown>[];
      prs_without_issues: Record<string, unknown>[];
      prs_awaiting_review: Record<string, unknown>[];
      stale_issues: Record<string, unknown>[];
      total_hygiene_issues: number;
    }>('GET', `/github/health?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`);

    return {
      issuesWithoutPrs: raw.issues_without_prs.map(r => this.adaptQueueItem(r)),
      prsWithoutIssues: raw.prs_without_issues.map(r => this.adaptQueueItem(r)),
      prsAwaitingReview: raw.prs_awaiting_review.map(r => this.adaptQueueItem(r)),
      staleIssues: raw.stale_issues.map(r => this.adaptQueueItem(r)),
      totalHygieneIssues: raw.total_hygiene_issues,
    };
  }

  // ─── Work Blocks ─────────────────────────────────────────────────────────

  async startWorkBlock(sessionId: string, item: QueueItem): Promise<WorkBlock> {
    const raw = await this.request<Record<string, unknown>>('POST', `/sessions/${sessionId}/blocks/start`, {
      item_ref: {
        type: item.type,
        number: item.id,
        title: item.title,
        url: item.url,
      },
      phase: 'understand',
    });
    return this.adaptWorkBlock(raw);
  }

  async updateBlockPhase(sessionId: string, blockId: string, phase: Phase): Promise<void> {
    await this.request<void>('POST', `/sessions/${sessionId}/blocks/${blockId}/phase`, { phase });
  }

  async endWorkBlock(sessionId: string, blockId: string, notes: string): Promise<void> {
    await this.request<void>('POST', `/sessions/${sessionId}/blocks/${blockId}/end`, {
      notes,
      annotated: false,
    });
  }

  // ─── Chat ────────────────────────────────────────────────────────────────

  async chat(sessionId: string, message: string, context: ChatContext): Promise<string> {
    const result = await this.request<{ reply: string }>('POST', '/conversation/chat', {
      session_id: sessionId,
      message,
      context,
    });
    return result.reply;
  }

  async getProactiveMessage(sessionId: string, trigger: ProactiveTrigger, context: ChatContext): Promise<string> {
    const result = await this.request<{ message: string }>('POST', '/conversation/proactive', {
      session_id: sessionId,
      trigger,
      context,
    });
    return result.message;
  }

  async getConversationHistory(sessionId: string): Promise<Message[]> {
    const raws = await this.request<Array<{id: string; role: string; content: string; trigger_event?: string; created_at: string}>>(
      'GET', `/conversation/${sessionId}/history`
    );
    return raws.map(r => ({
      id: r.id,
      role: r.role as Message['role'],
      content: r.content,
      timestamp: r.created_at,
      trigger: r.trigger_event as ProactiveTrigger | undefined,
    }));
  }

  // ─── Puzzles ─────────────────────────────────────────────────────────────

  async getTodayPuzzle(): Promise<Puzzle> {
    const raw = await this.request<Record<string, unknown>>('GET', '/puzzle/today');
    return this.adaptPuzzle(raw);
  }

  async submitPuzzle(puzzleDate: string, answer: string, timeSeconds: number): Promise<PuzzleResult> {
    const raw = await this.request<Record<string, unknown>>('POST', '/puzzle/submit', {
      puzzle_date: puzzleDate,
      answer,
      time_seconds: timeSeconds,
    });
    return this.adaptPuzzleResult(raw, timeSeconds);
  }

  async getPuzzleStreak(): Promise<PuzzleStreak> {
    const raw = await this.request<Record<string, unknown>>('GET', '/puzzle/streak');
    return this.adaptPuzzleStreak(raw);
  }

  async createStreakGist(weekStart: string, daysCompleted: number): Promise<string | null> {
    const raw = await this.request<{ gist_url: string | null; success: boolean }>(
      'POST', '/puzzle/streak-gist', { week_start: weekStart, days_completed: daysCompleted }
    );
    return raw.gist_url;
  }

  // ─── Analytics ───────────────────────────────────────────────────────────

  async getVelocity(days: number): Promise<VelocityData[]> {
    const raws = await this.request<Array<{date: string; prs_merged: number; prs_reviewed: number}>>(
      'GET', `/analytics/velocity?days=${days}`
    );
    return raws.map(r => ({
      date: r.date,
      prsMerged: r.prs_merged,
      prsReviewed: r.prs_reviewed,
      issuesAnnotated: 0,
      minutesWorked: 0,
    }));
  }

  async getCoachingSignals(): Promise<CoachingSignals> {
    const raw = await this.request<{
      annotation_rate: number | null;
      avg_review_latency_hours: number | null;
      weekly_puzzle_streak: number;
      coaching_level: string | null;
      focus_score?: number;
      consistency_score?: number;
      recommendations?: string[];
    }>('GET', '/analytics/coaching-signals');
    return {
      annotationRate: raw.annotation_rate ?? 0,
      reviewLatencyHours: raw.avg_review_latency_hours ?? 0,
      focusScore: raw.focus_score ?? 0,
      consistencyScore: raw.consistency_score ?? 0,
      recommendations: raw.recommendations ?? [],
    };
  }

  async getPhaseBalance(sessionId?: string): Promise<Array<{phase: string; totalMinutes: number; blockCount: number}>> {
    const url = sessionId
      ? `/analytics/balance?session_id=${sessionId}`
      : '/analytics/balance';
    const raws = await this.request<Array<{phase: string; total_minutes: number; block_count: number}>>('GET', url);
    return raws.map(r => ({ phase: r.phase, totalMinutes: r.total_minutes, blockCount: r.block_count }));
  }

  async getCoachingProfile(): Promise<CoachingProfile> {
    const raw = await this.request<{
      coaching_level: string;
      annotation_rate: number | null;
      avg_review_latency_hours: number | null;
      prs_merged: number;
      prs_reviewed: number;
      week_start: string | null;
    }>('GET', '/sessions/coaching-profile');
    return {
      coachingLevel: raw.coaching_level,
      annotationRate: raw.annotation_rate,
      avgReviewLatencyHours: raw.avg_review_latency_hours,
      prsMerged: raw.prs_merged,
      prsReviewed: raw.prs_reviewed,
      weekStart: raw.week_start,
    };
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const token = await this.tokenGetter();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
    if (this.anthropicKey) {
      headers['X-Anthropic-Key'] = this.anthropicKey;
    }

    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      throw new ApiError(0, `Network error: ${(err as Error).message}`);
    }

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const json = (await response.json()) as { detail?: string };
        if (json.detail) {
          detail = json.detail;
        }
      } catch {
        // ignore JSON parse errors on error bodies
      }
      throw new ApiError(response.status, detail);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as unknown as T;
    }

    return response.json() as Promise<T>;
  }
}

export interface CoachingProfile {
  coachingLevel: string;
  annotationRate: number | null;
  avgReviewLatencyHours: number | null;
  prsMerged: number;
  prsReviewed: number;
  weekStart: string | null;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
