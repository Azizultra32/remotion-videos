#!/usr/bin/env bash
# Full deep-analysis pipeline for a track. Produces three JSON files in
# public/ that the editor's audio-reactive elements consume:
#
#   <name>-beats.json           beats, downbeats, tempo, drops, breakdowns, energy
#   <name>-energy-<fps>fps.json per-frame onset-flash curve
#   <name>-spectrum-<fps>fps.json per-frame 16-band spectrum
#
# Usage:
#   scripts/analyze-audio.sh <audio-path> [--fps 24] [--no-intro]
#
# Examples:
#   scripts/analyze-audio.sh public/love-in-traffic.mp3
#   scripts/analyze-audio.sh public/dubfire-sake.wav --fps 30
#
# The <name> is derived from the audio filename (stem). All steps are
# idempotent — re-running overwrites the previous JSONs.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <audio-path> [--fps N] [--no-intro]" >&2
  exit 1
fi

AUDIO="$1"; shift
FPS=24
EXTEND_INTRO="--extend-intro"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fps) FPS="$2"; shift 2 ;;
    --no-intro) EXTEND_INTRO=""; shift ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -f "$AUDIO" ]]; then
  echo "audio file not found: $AUDIO" >&2
  exit 1
fi

# Derive the stem (filename without extension or path).
NAME=$(basename "$AUDIO")
NAME="${NAME%.*}"

BEATS_OUT="public/${NAME}-beats.json"
ENERGY_OUT="public/${NAME}-energy-${FPS}fps.json"
SPECTRUM_OUT="public/${NAME}-spectrum-${FPS}fps.json"

echo "╭─ deep audio analysis ──────────────────────────────────────────"
echo "│ track:    $AUDIO"
echo "│ fps:      $FPS"
echo "│ intro:    $([ -n "$EXTEND_INTRO" ] && echo "extended (backfill)" || echo "skip (detector-only)")"
echo "│ outputs:  $BEATS_OUT"
echo "│           $ENERGY_OUT"
echo "│           $SPECTRUM_OUT"
echo "╰────────────────────────────────────────────────────────────────"

echo "» [1/4] beats + downbeats + tempo curve"
python3 scripts/detect-beats.py --audio "$AUDIO" --out "$BEATS_OUT" $EXTEND_INTRO

echo "» [2/4] drops + breakdowns + bass energy"
python3 scripts/detect-drops.py --audio "$AUDIO" --beats-json "$BEATS_OUT"

echo "» [3/4] per-frame onset flash @ ${FPS}fps"
python3 scripts/hires-energy.py --audio "$AUDIO" --fps "$FPS" --out "$ENERGY_OUT"

echo "» [4/5] per-frame 16-band spectrum @ ${FPS}fps"
python3 scripts/compute-spectrum.py --audio "$AUDIO" --fps "$FPS" --out "$SPECTRUM_OUT"

echo "» [5/5] verifying detector output"
python3 scripts/verify-detector.py "$BEATS_OUT"

echo
echo "✓ done. Point the editor at it with ?beats=/${NAME}-beats.json"
