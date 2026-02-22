# DevCoach Architecture

## Overview

DevCoach is a two-process system: a VS Code Extension (frontend) and a FastAPI service (backend). They communicate over HTTP. All AI calls go through the backend — the extension never calls the Anthropic API directly.

## Extension ↔ Backend Communication

All requests include `Authorization: Bearer <github_pat>`. The backend resolves the GitHub PAT to a user on the first call (via GitHub /user API) and upserts a `users` row. Subsequent calls reuse the cached user record for that PAT.

Anthropic API key is stored in VS Code SecretStorage (OS keychain) and sent to the backend as `X-Anthropic-Key` on conversation requests.

## VS Code Extension

**Extension host** (Node.js / CommonJS):
- `extension.ts` — activation, command registration, secret management
- `SidebarProvider.ts` — WebviewViewProvider for the activity bar sidebar
- `PanelProvider.ts` — WebviewPanel for undocked usage
- `ApiClient.ts` — typed HTTP client for all backend calls
- `GitHubCli.ts` — `gh` CLI wrapper using `execFile` (no shell injection)

**Webview** (React, bundled by esbuild):
- Single-page app, communicates with extension host via `postMessage`
- Tabs: Today | Queue | Chat | Charts | Puzzle
- No direct network calls — all requests go through the extension host to the backend (or directly to backend with PAT from init message, depending on context)
- Uses VS Code CSS variables throughout — inherits editor theme

## FastAPI Backend

**Routers:**
- `POST /sessions/start` — begins a day session, returns top-3 GitHub recommendations
- `GET /sessions/today` — current day session
- `POST /sessions/{id}/end` — closes session, triggers journal write
- `POST /sessions/{id}/blocks/start|end` — work block lifecycle
- `GET /github/queue` — scored + sorted GitHub queue
- `GET /github/queue/recommendations` — top 3 picks (Math Test sort)
- `POST /conversation/chat` — Haiku conversation with coaching context
- `POST /conversation/proactive` — trigger-based coaching nudge
- `GET /puzzle/today` — today's puzzle (answer field hidden)
- `POST /puzzle/submit` — evaluate answer, award badges
- `GET /analytics/velocity` — PRs merged/reviewed per day

**Services:**
- `github_service.py` — httpx async GitHub REST API calls
- `scoring_service.py` — pure functions, confidence_score formula
- `haiku_service.py` — Anthropic SDK, chat + puzzle generation
- `journal_service.py` — GitHub API read/write of `.devcoach/journal.md`
- `coaching_service.py` — Peter/Ransom detection, prompt selection
- `puzzle_service.py` — daily puzzle lifecycle, badge awards

## Database (PostgreSQL)

7 tables: `users`, `day_sessions`, `work_blocks`, `conversations`, `puzzle_attempts`, `badges`, `coaching_profiles`.

All managed via Alembic async migrations. Uses `timestamptz` throughout, `uuid` primary keys, `jsonb` for flexible item metadata.

## Data Split: DB vs GitHub

| Data | Storage | Reason |
|------|---------|--------|
| User profiles, sessions, conversations | PostgreSQL | Structured, queryable, private |
| Project learnings, daily journal | `.devcoach/journal.md` in repo | Code-adjacent, version-controlled, visible to team |
| Badges (weekly) | PostgreSQL + GitHub Gist | DB for fast lookup, Gist for sharing |

## Security Notes

- GitHub PATs never logged, never stored in plaintext (stored encrypted in `github_token_enc`)
- Anthropic key never persisted server-side — passed per-request
- CORS restricted to configured origins
- No `GRANT ALL` — application role has SELECT/INSERT/UPDATE/DELETE per table
- All SQL via SQLAlchemy ORM + parameterized queries (TOON-006)
