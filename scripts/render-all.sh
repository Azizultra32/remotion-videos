#!/bin/bash
# Render all compositions in the project
# Usage: ./scripts/render-all.sh [--codec h264] [--quality high|medium|low]

set -e
cd "$(dirname "$0")/.."

CODEC="${1:-h264}"
QUALITY="${2:-medium}"

case "$QUALITY" in
  high) CRF=18 ;;
  medium) CRF=23 ;;
  low) CRF=28 ;;
esac

mkdir -p out

echo "=== Rendering all compositions ==="
COMPOSITIONS=$(npx remotion compositions src/index.ts --quiet 2>/dev/null)

for COMP in $COMPOSITIONS; do
  echo "Rendering: $COMP"
  npx remotion render src/index.ts "$COMP" "out/${COMP}.mp4" --codec "$CODEC" --crf "$CRF" 2>&1
  echo "  ✓ $COMP done"
done

echo "=== All renders complete ==="
ls -lh out/*.mp4
