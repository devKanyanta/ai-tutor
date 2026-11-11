#!/usr/bin/env bash
# Runs ON THE SERVER (called over SSH by .github/workflows/ci-cd.yml).
# Updates the backend code and dependencies, then restarts the API.
# The built frontend is uploaded separately by the workflow into frontend/dist.
set -euo pipefail

APP_DIR="${APP_DIR:-/root/ai-tutor}"
PM2_API="${PM2_API:-socratic-api}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8099/api/health}"

cd "$APP_DIR"

echo "==> Fetching code"
git fetch --quiet origin main
PREVIOUS="$(git rev-parse HEAD)"
git reset --hard origin/main      # tracked files only: .env, data/, .venv and dist/ are untouched
echo "    $PREVIOUS -> $(git rev-parse HEAD)"

echo "==> Installing backend dependencies"
backend/.venv/bin/pip install --quiet -r backend/requirements.txt

echo "==> Restarting $PM2_API"
pm2 restart "$PM2_API" --update-env >/dev/null

echo "==> Waiting for the API to become healthy"
for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "    healthy"
    pm2 save >/dev/null
    exit 0
  fi
  sleep 2
done

echo "!! API did not become healthy. Last error log lines:" >&2
pm2 logs "$PM2_API" --err --lines 30 --nostream >&2 || true
echo "!! Rolling back to $PREVIOUS" >&2
git reset --hard "$PREVIOUS"
backend/.venv/bin/pip install --quiet -r backend/requirements.txt || true
pm2 restart "$PM2_API" --update-env >/dev/null || true
exit 1
