#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS_DIR="$ROOT_DIR/.git/hooks"

echo "Installing git hooks for Lunchbench..."

cat > "$HOOKS_DIR/pre-push" << 'HOOK'
#!/usr/bin/env bash
# Lunchbench pre-push hook: runs E2E tests before pushing
# DO NOT BYPASS with --no-verify. See docs/e2e-testing.md.

echo "Running E2E tests before push..."
"$(git rev-parse --show-toplevel)/scripts/run-e2e.sh"
HOOK

chmod +x "$HOOKS_DIR/pre-push"

echo "pre-push hook installed at $HOOKS_DIR/pre-push"
echo ""
echo "To run E2E tests manually:"
echo "  ./scripts/run-e2e.sh"
echo ""
echo "IMPORTANT: Never bypass with 'git push --no-verify'."
echo "See docs/e2e-testing.md for the policy."
