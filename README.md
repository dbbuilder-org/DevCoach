# DevCoach

An AI-powered daily engineering coach delivered as a VS Code extension, backed by a FastAPI service.

DevCoach structures your engineering day into focused work blocks, analyzes your GitHub issue/PR queue each morning using the "Math Test Method" (tackle what you know first to build momentum), and coaches you through each phase of a work item via Claude Haiku.

---

## Architecture

```
VS Code Extension (TypeScript + React)
        ↕ HTTP
FastAPI Backend (Python, hosted on Render)
        ↕
PostgreSQL (Render) + GitHub repos (.devcoach/journal.md)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full detail.

---

## Getting Started

### Prerequisites
- Node.js 20+
- Python 3.11+
- PostgreSQL running locally (or a Render account for hosted)
- A GitHub Personal Access Token (`repo` + `read:user` scopes)
- An Anthropic API key

### Automated setup

Run this from the repo root:

```bash
bash setup.sh
```

The script will:
- Create and activate a Python virtualenv, install backend dependencies
- Create `backend/.env` from `.env.example` and generate a `SECRET_KEY`
- Create the `devcoach` PostgreSQL database and run Alembic migrations
- Run `npm install` and build the VS Code extension

It will print step-by-step instructions for the three things that can't be scripted:

**1. Fill in `backend/.env`** — paste in your `ANTHROPIC_API_KEY` and confirm `DATABASE_URL` matches your local Postgres.

**2. Start the backend**
```bash
cd backend && source .venv/bin/activate
uvicorn main:app --reload --port 8000
# Verify: http://localhost:8000/health
# API docs: http://localhost:8000/docs
```

**3. Launch the extension**

Option A — dev mode with live reload:
```bash
cd extension && npm run watch
# Then press F5 in VS Code → Extension Development Host opens
```

Option B — install the packaged extension:
```bash
code --install-extension extension/devcoach-0.1.0.vsix
```

**4. Configure API keys (first launch)**

`Cmd+Shift+P` → **DevCoach: Configure API Keys** → enter your GitHub PAT and Anthropic key.

**5. Start your day**

`Cmd+Shift+P` → **DevCoach: Start My Day**, or click the DevCoach icon in the activity bar.

---

## Day Structure

| Time  | Block            | Duration |
|-------|-----------------|----------|
| 08:30 | Morning Warm-Up (Puzzle) | 15 min |
| 08:45 | Day Planning     | 20 min   |
| 09:05 | Work Block 1     | 2 hours  |
| 11:05 | Work Block 2     | 2 hours  |
| 13:05 | Flex Hour        | 60 min   |
| 14:05 | Work Block 3     | 2 hours  |
| 16:05 | Day Close        | 15 min   |

Each work block: Understand (20m) → Address (60m) → Test (20m) → PR (15m) → Annotate (5m)

---

## Coaching Modes

**Peter mode** (high autonomy): minimal interruption, velocity dashboards, peer-level conversation.
**Ransom mode** (structured coaching): Pomodoro check-ins, annotation reminders, regression guards, Socratic prompts.

Mode is auto-detected weekly from PR throughput, annotation rate, and review latency.

---

## Deploy to Render

1. Push to GitHub
2. Connect repo in Render dashboard
3. Render picks up `render.yaml` automatically
4. Set `ANTHROPIC_API_KEY` as an environment secret in the Render dashboard
5. Run `alembic upgrade head` via Render shell after first deploy

---

## Project Structure

```
devcoach/
├── backend/          FastAPI service
├── extension/        VS Code extension
├── docs/             Architecture, coaching model docs
└── render.yaml       Render deployment
```
