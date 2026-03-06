#!/bin/bash
# Quick preview: render a single frame from a composition
# Usage: ./scripts/preview-frame.sh <composition-id> [frame-number]

set -e
cd "$(dirname "$0")/.."

COMP="$1"
FRAME="${2:-0}"

if [ -z "$COMP" ]; then
  echo "Usage: $0 <composition-id> [frame-number]"
  echo "Available compositions:"
  npx remotion compositions src/index.ts --quiet 2>/dev/null
  exit 1
fi

mkdir -p out/previews
OUTPUT="out/previews/${COMP}-frame${FRAME}.png"
npx remotion still src/index.ts "$COMP" "$OUTPUT" --frame "$FRAME" 2>&1
echo "✓ Preview: $OUTPUT"
