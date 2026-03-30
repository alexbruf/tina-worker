#!/bin/bash
# Installs git hooks for the monorepo. Run once after cloning: bun run install-hooks
set -e

HOOKS_DIR="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)/.git/hooks"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

HOOK="$HOOKS_DIR/pre-commit"

# If a hook already exists and isn't ours, append to it
if [ -f "$HOOK" ] && ! grep -q "check-images" "$HOOK" 2>/dev/null; then
  echo "" >> "$HOOK"
  echo "# tina-worker image size check" >> "$HOOK"
  echo "\"$SCRIPT_DIR/check-images.sh\"" >> "$HOOK"
  echo "Appended image check to existing pre-commit hook."
else
  cat > "$HOOK" <<EOF
#!/bin/bash
"$SCRIPT_DIR/check-images.sh"
EOF
  chmod +x "$HOOK"
  echo "Installed pre-commit hook → $HOOK"
fi
