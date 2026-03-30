#!/bin/bash
# Rejects staged images in tina-worker/public/uploads/ that exceed the size limit.
# Run directly or via the pre-commit hook (scripts/install-hooks.sh).

MAX_KB=800
MAX_BYTES=$((MAX_KB * 1024))
FAILED=0

while IFS= read -r -d '' file; do
  # file is a repo-relative path; resolve to absolute
  abs="$(git rev-parse --show-toplevel)/$file"
  if [ ! -f "$abs" ]; then continue; fi

  size=$(wc -c < "$abs")
  size_kb=$(( (size + 1023) / 1024 ))

  if [ "$size" -gt "$MAX_BYTES" ]; then
    echo "  ✗ $file  (${size_kb}KB > ${MAX_KB}KB limit)"
    FAILED=1
  fi
done < <(git diff --cached --name-only --diff-filter=ACM -z | \
  grep -z -E '^tina-worker/public/uploads/.+\.(jpg|jpeg|png|gif|webp|avif)$')

if [ "$FAILED" -eq 1 ]; then
  echo ""
  echo "Images above ${MAX_KB}KB blocked. Compress before committing."
  echo "  macOS:  sips -Z 2000 image.jpg  (resize to max 2000px)"
  echo "  brew:   brew install imagemagick && convert image.jpg -quality 80 image.jpg"
  exit 1
fi
