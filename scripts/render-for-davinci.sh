#!/usr/bin/env bash
# Render a Remotion composition in a DaVinci-friendly codec, and emit a
# sidecar marker file so DaVinci opens the clip with beat/drop markers on
# the timeline.
#
# DaVinci prefers ProRes (macOS-native) or DNxHR HQ (cross-platform) over
# H.264/HEVC. Loading H.264 into DaVinci forces optimized-media re-encoding
# (slow) and can lose color precision during grading. ProRes 4444 carries
# alpha if you ever need it; ProRes HQ is the common choice for delivery.
#
# Usage:
#   scripts/render-for-davinci.sh <CompositionId> [output-name]
#   scripts/render-for-davinci.sh PublicCut
#   scripts/render-for-davinci.sh BeatDrop out/drop-v3
#   CODEC=dnxhr-hq scripts/render-for-davinci.sh PublicCut   # override codec
#   BEATS=public/dubfire-beats.json scripts/render-for-davinci.sh BeatDrop
#
# Environment:
#   CODEC         prores-4444 | prores-hq | dnxhr-hq (default: prores-hq)
#   BEATS         path to beats.json for marker sidecar (default: public/dubfire-beats.json)
#   TAG_RENDER    if 1, also create a git tag 'render-<comp>-<date>' after render

set -euo pipefail

COMP_ID="${1:-}"
OUT_BASE="${2:-}"
CODEC="${CODEC:-prores-hq}"
BEATS="${BEATS:-public/dubfire-beats.json}"
TAG_RENDER="${TAG_RENDER:-0}"

if [[ -z "$COMP_ID" ]]; then
  echo "Usage: $0 <CompositionId> [output-basename]" >&2
  echo "  CODEC=prores-4444|prores-hq|dnxhr-hq (default prores-hq)" >&2
  exit 1
fi

if [[ -z "$OUT_BASE" ]]; then
  # Default: out/<CompId>-<shortSHA>[-dirty]
  SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "nogit")
  DIRTY=""
  if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
    DIRTY="-dirty"
    echo "⚠️  Working tree has uncommitted changes — this render won't correspond to a clean git SHA." >&2
    echo "   Consider committing first (see CLAUDE.md > Git Hygiene)." >&2
  fi
  OUT_BASE="out/${COMP_ID}-${SHA}${DIRTY}"
fi

mkdir -p "$(dirname "$OUT_BASE")"

case "$CODEC" in
  prores-4444)
    EXT="mov"
    CODEC_FLAG="--codec=prores --prores-profile=4444"
    ;;
  prores-hq)
    EXT="mov"
    CODEC_FLAG="--codec=prores --prores-profile=hq"
    ;;
  dnxhr-hq)
    EXT="mxf"
    # DNxHR HQ via ffmpeg post-process — Remotion's native codecs don't
    # include DNxHR yet, so we render ProRes then transcode. This is still
    # lossless enough for grading (ProRes → DNxHR both 10-bit 4:2:2).
    EXT="mov"
    CODEC_FLAG="--codec=prores --prores-profile=hq"
    POST_TRANSCODE_DNXHR=1
    ;;
  *)
    echo "ERROR: unsupported CODEC=$CODEC (valid: prores-4444, prores-hq, dnxhr-hq)" >&2
    exit 2
    ;;
esac

OUT_FILE="${OUT_BASE}.${EXT}"
echo "Rendering $COMP_ID → $OUT_FILE  (codec=$CODEC)"
echo ""

# shellcheck disable=SC2086
npx remotion render src/index.ts "$COMP_ID" "$OUT_FILE" $CODEC_FLAG

if [[ -n "${POST_TRANSCODE_DNXHR:-}" ]]; then
  DNX_OUT="${OUT_BASE}.mxf"
  echo ""
  echo "Transcoding ProRes → DNxHR HQ: $DNX_OUT"
  ffmpeg -hide_banner -loglevel warning -y \
    -i "$OUT_FILE" \
    -c:v dnxhd -profile:v dnxhr_hq -pix_fmt yuv422p \
    -c:a pcm_s16le \
    "$DNX_OUT"
  rm "$OUT_FILE"
  OUT_FILE="$DNX_OUT"
  echo "  → $OUT_FILE"
fi

# Sidecar markers — only if beats file exists.
if [[ -f "$BEATS" ]]; then
  MARKER_FILE="${OUT_BASE}-markers.edl"
  echo ""
  echo "Emitting DaVinci marker EDL: $MARKER_FILE"
  if [[ -f scripts/emit-davinci-markers.ts ]]; then
    npx tsx scripts/emit-davinci-markers.ts \
      --beats "$BEATS" \
      --video "$OUT_FILE" \
      --out "$MARKER_FILE"
  else
    echo "  (scripts/emit-davinci-markers.ts not found, skipping markers)" >&2
  fi
fi

echo ""
echo "✅ Render complete: $OUT_FILE"

if [[ "$TAG_RENDER" == "1" ]]; then
  STAMP=$(date +%Y%m%d-%H%M)
  TAG="render-${COMP_ID,,}-${STAMP}"
  git tag -a "$TAG" -m "Render: $COMP_ID → $OUT_FILE ($CODEC)" && \
    echo "   git tag: $TAG"
fi

echo ""
echo "Next: import $OUT_FILE into DaVinci Resolve and drop on timeline."
if [[ -f "${OUT_BASE}-markers.edl" ]]; then
  echo "      Import markers: File > Import > Timeline > ${OUT_BASE}-markers.edl"
fi
