#!/usr/bin/env bash
# DevCoach local dev setup
# Run from the repo root: bash setup.sh

set -e

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
CYAN="\033[36m"
RESET="\033[0m"

step() { echo -e "\n${BOLD}${CYAN}▶ $1${RESET}"; }
ok()   { echo -e "${GREEN}  ✓ $1${RESET}"; }
note() { echo -e "${YELLOW}  ! $1${RESET}"; }

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$REPO_ROOT/backend"
EXTENSION="$REPO_ROOT/extension"

# ── 0. Prerequisites check ───────────────────────────────────────────────────

step "Checking prerequisites"

for cmd in python3 node npm psql; do
  if command -v "$cmd" &>/dev/null; then
    ok "$cmd found ($(command -v $cmd))"
  else
    echo "  ✗ $cmd not found — please install it and re-run."
    exit 1
  fi
done

# ── 1. Backend ────────────────────────────────────────────────────────────────

step "Setting up Python backend"

cd "$BACKEND"

if [ ! -d .venv ]; then
  python3 -m venv .venv
  ok "Created .venv"
else
  ok ".venv already exists"
fi

source .venv/bin/activate
pip install -r requirements.txt -q
ok "Dependencies installed"

if [ ! -f .env ]; then
  cp .env.example .env
  ok "Created backend/.env from .env.example"
else
  ok "backend/.env already exists"
fi

# ── 2. Database ───────────────────────────────────────────────────────────────

step "Setting up PostgreSQL database"

if psql -lqt 2>/dev/null | cut -d '|' -f1 | grep -qw devcoach; then
  ok "Database 'devcoach' already exists"
else
  createdb devcoach
  ok "Created database 'devcoach'"
fi

# Only run migrations if DATABASE_URL looks usable (not the placeholder)
DB_URL=$(grep DATABASE_URL .env | cut -d= -f2-)
if [[ "$DB_URL" == *"user:password"* ]]; then
  note "DATABASE_URL in backend/.env still has placeholder values — skipping migrations"
else
  alembic upgrade head
  ok "Migrations applied"
fi

# ── 3. Extension ──────────────────────────────────────────────────────────────

step "Setting up VS Code extension"

cd "$EXTENSION"
npm install --silent
ok "Node dependencies installed"

npm run build
ok "Extension built (out/)"

# ── 4. Done — print manual steps ─────────────────────────────────────────────

echo ""
echo -e "${BOLD}════════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  Setup complete — a few manual steps remain:${RESET}"
echo -e "${BOLD}════════════════════════════════════════════════════════════${RESET}"

echo ""
echo -e "${BOLD}1. Configure backend/.env${RESET}"
echo "   Open backend/.env and fill in:"
echo ""
echo "     DATABASE_URL=postgresql+asyncpg://localhost/devcoach"
echo "     ANTHROPIC_API_KEY=sk-ant-..."
echo "     SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
echo ""
echo "   (A SECRET_KEY has been generated above — paste it in.)"

echo ""
echo -e "${BOLD}2. Start the backend${RESET}"
echo "   cd backend"
echo "   source .venv/bin/activate"
echo "   uvicorn main:app --reload --port 8000"
echo ""
echo "   Verify: http://localhost:8000/health"
echo "   API docs: http://localhost:8000/docs"

echo ""
echo -e "${BOLD}3. Launch the extension in VS Code${RESET}"
echo ""
echo "   Option A — Development (live reload):"
echo "     cd extension && npm run watch"
echo "     Then press F5 in VS Code to open Extension Development Host"
echo ""
echo "   Option B — Install the packaged .vsix:"
echo "     code --install-extension extension/devcoach-0.1.0.vsix"

echo ""
echo -e "${BOLD}4. Configure API keys (first launch)${RESET}"
echo "   In VS Code: Cmd+Shift+P → 'DevCoach: Configure API Keys'"
echo "   Enter:"
echo "     • GitHub Personal Access Token (scopes: repo, read:user)"
echo "     • Anthropic API key"

echo ""
echo -e "${BOLD}5. Start your day${RESET}"
echo "   Cmd+Shift+P → 'DevCoach: Start My Day'"
echo "   Or click the DevCoach icon in the activity bar."

echo ""
echo -e "${BOLD}Quick smoke test (no extension needed):${RESET}"
echo "   curl http://localhost:8000/health"
echo "   curl -H 'Authorization: Bearer YOUR_GITHUB_PAT' \\"
echo "     'http://localhost:8000/github/queue?owner=YOUR_ORG&repo=YOUR_REPO'"

echo ""
