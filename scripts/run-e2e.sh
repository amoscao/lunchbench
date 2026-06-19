#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_NAME="lunchbench-e2e-$$"
COMPOSE=(docker compose -p "$PROJECT_NAME" -f docker-compose.e2e.yml)

echo "Running Lunchbench E2E tests in Docker..."
echo "This may take several minutes on first run while images build or download."
echo ""

cd "$ROOT_DIR"

"${COMPOSE[@]}" down --volumes --remove-orphans 2>/dev/null || true

set +e
"${COMPOSE[@]}" up --build -d api frontend
START_EXIT_CODE=$?
if [ "$START_EXIT_CODE" -eq 0 ]; then
  "${COMPOSE[@]}" run --rm playwright
  EXIT_CODE=$?
else
  EXIT_CODE=$START_EXIT_CODE
fi
EXIT_CODE=${EXIT_CODE:-1}
set -e

"${COMPOSE[@]}" down --volumes --remove-orphans 2>/dev/null || true

if [ "$EXIT_CODE" -eq 0 ]; then
  echo ""
  echo "All E2E tests passed."
else
  echo ""
  echo "E2E tests failed (exit code $EXIT_CODE)."
  echo "See playwright-report/ in the e2e/ directory for details."
  echo "Run 'cd e2e && npx playwright show-report' to view the HTML report."
fi

exit "$EXIT_CODE"
