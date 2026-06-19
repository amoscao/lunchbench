#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Running Lunchbench E2E tests in Docker..."
echo "This may take several minutes on first run while images build or download."
echo ""

cd "$ROOT_DIR"

docker compose -f docker-compose.e2e.yml down --volumes --remove-orphans 2>/dev/null || true

set +e
docker compose -f docker-compose.e2e.yml up \
  --build \
  --abort-on-container-exit \
  --exit-code-from playwright

EXIT_CODE=$?
set -e

docker compose -f docker-compose.e2e.yml down --volumes --remove-orphans 2>/dev/null || true

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
