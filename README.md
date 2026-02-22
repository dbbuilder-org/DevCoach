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
- A GitHub Personal Access Token (repo + read:user scopes)
- An Anthropic API key
- PostgreSQL (or a Render account for hosted)

### Backend (local dev)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# edit .env with your DATABASE_URL, ANTHROPIC_API_KEY, SECRET_KEY

# Create database and run migrations
createdb devcoach
alembic upgrade head

# Start server
uvicorn main:app --reload --port 8000
```

### Extension (local dev)

```bash
cd extension
npm install
npm run watch   # watches both extension host and webview

# In VS Code: F5 to launch Extension Development Host
```

On first launch, run **DevCoach: Configure API Keys** from the command palette.

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
