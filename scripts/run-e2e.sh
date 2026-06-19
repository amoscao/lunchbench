#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_NAME="lunchbench-e2e-$$"
COMPOSE=(docker compose -p "$PROJECT_NAME" -f "$ROOT_DIR/docker-compose.e2e.yml")
EXIT_CODE=1

cleanup() {
  set +e
  for _ in 1 2 3; do
    "${COMPOSE[@]}" down --volumes --remove-orphans 2>/dev/null
    docker ps -a --filter 'name=lunchbench-e2e' --format '{{.ID}}' | xargs -r docker rm -f >/dev/null 2>&1
    docker network ls --filter 'name=lunchbench-e2e' --format '{{.ID}}' | xargs -r docker network rm >/dev/null 2>&1
    docker volume ls --filter 'name=lunchbench-e2e' --format '{{.Name}}' | xargs -r docker volume rm -f >/dev/null 2>&1
    docker image ls --format '{{.Repository}}:{{.Tag}}' | grep '^lunchbench-e2e-' | xargs -r docker image rm -f >/dev/null 2>&1
    sleep 1
  done
}

handle_interrupt() {
  EXIT_CODE=130
  cleanup
  exit "$EXIT_CODE"
}

trap cleanup EXIT
trap handle_interrupt INT TERM

echo "Running Lunchbench E2E tests in Docker..."
echo "This may take several minutes on first run while images build or download."
echo ""

cd "$ROOT_DIR"

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
