#!/usr/bin/env bash
# Extract each entry in segments.json into its own folder with local
# audio, video, and rebased beats.json.
#
# Inputs:
#   $1  segments.json  (produced by scripts/segment-audio.py)
#   $2  source audio   (WAV or lossless)
#   $3  source video   (MP4, optional)
#   $4  source beats.json (absolute timestamps)
#   $5  output dir     (e.g. projects/dubfire-sake/segments)
#
# For each segment, creates:
#   <out>/<name>/audio.wav
#   <out>/<name>/video.mp4          (if source video provided)
#   <out>/<name>/beats.json         (timestamps rebased to segment-local 0)
#   <out>/<name>/segment.json       (scaffold matching segmentManifest schema)
#
# Requirements: ffmpeg, jq, python3

set -euo pipefail

if [[ $# -lt 4 ]]; then
  cat >&2 <<'USAGE'
Usage:
  extract-segments.sh <segments.json> <source-audio> [source-video] <source-beats.json> <output-dir>

  extract-segments.sh public/dubfire-segments.json out/dubfire-sake.wav public/dubfire-sake.mp4 public/dubfire-beats.json projects/dubfire-sake/segments/

  # If no video source is available, pass '' as the video arg:
  extract-segments.sh segments.json audio.wav '' beats.json out/
USAGE
  exit 1
fi

SEGMENTS_JSON="$1"
SRC_AUDIO="$2"
SRC_VIDEO="${3:-}"
SRC_BEATS="$4"
OUT_DIR="$5"

for bin in ffmpeg jq python3; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "ERROR: $bin not found in PATH" >&2
    exit 2
  fi
done

for f in "$SEGMENTS_JSON" "$SRC_AUDIO" "$SRC_BEATS"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: file not found: $f" >&2
    exit 3
  fi
done

if [[ -n "$SRC_VIDEO" && ! -f "$SRC_VIDEO" ]]; then
  echo "ERROR: source video not found: $SRC_VIDEO" >&2
  exit 3
fi

mkdir -p "$OUT_DIR"

TOTAL=$(jq '.segments | length' "$SEGMENTS_JSON")
echo "Extracting $TOTAL segments to $OUT_DIR"

# Iterate segments using jq to emit name/start/end triples.
i=0
jq -r '.segments[] | [.name, .startSec, .endSec, .reason, .containsDrops, .containsBreakdowns] | @tsv' "$SEGMENTS_JSON" | \
while IFS=$'\t' read -r NAME START END REASON DROPS BDS; do
  i=$((i + 1))
  SEG_DIR="$OUT_DIR/$NAME"
  mkdir -p "$SEG_DIR"
  DUR=$(python3 -c "print(f'{float($END) - float($START):.4f}')")

  echo "[$i/$TOTAL] $NAME  $START→$END  (${DUR}s)  $REASON"

  # Audio: lossless re-encode to WAV (libvorbis/libopus/aac all acceptable, but
  # WAV is simplest for analysis downstream).
  if [[ ! -f "$SEG_DIR/audio.wav" ]]; then
    ffmpeg -hide_banner -loglevel error -y \
      -ss "$START" -t "$DUR" \
      -i "$SRC_AUDIO" \
      -c:a pcm_s16le \
      "$SEG_DIR/audio.wav"
  else
    echo "  skip audio (already exists)"
  fi

  # Video: copy container stream if possible, fallback to re-encode with
  # keyframe-accurate cut.
  if [[ -n "$SRC_VIDEO" ]]; then
    if [[ ! -f "$SEG_DIR/video.mp4" ]]; then
      ffmpeg -hide_banner -loglevel error -y \
        -ss "$START" -t "$DUR" \
        -i "$SRC_VIDEO" \
        -c:v libx264 -preset veryfast -crf 18 \
        -c:a aac -b:a 192k \
        "$SEG_DIR/video.mp4"
    else
      echo "  skip video (already exists)"
    fi
  fi

  # Rebased beats.json — subtract START from every timestamp, filter to the
  # [START, END] window, and reindex.
  python3 - <<PYEOF
import json, sys
with open("$SRC_BEATS") as f:
    src = json.load(f)
start = float($START)
end = float($END)
def rebase(arr, offset):
    return [round(t - offset, 4) for t in arr if start <= t < end]
def rebase_regions(arr, offset):
    out = []
    for r in arr:
        if isinstance(r, dict) and "start" in r and "end" in r:
            # include if it overlaps the window
            if r["end"] >= start and r["start"] < end:
                out.append({
                    "start": round(max(0.0, r["start"] - offset), 4),
                    "end": round(min(end - start, r["end"] - offset), 4),
                })
    return out
out = {
    "duration": round(end - start, 4),
    "bpm_global": src.get("bpm_global"),
    "beats": rebase(src.get("beats", []), start),
    "downbeats": rebase(src.get("downbeats", []), start),
    "drops": rebase(src.get("drops", []), start),
    "breakdowns": rebase_regions(src.get("breakdowns", []), start),
    # keep tempo_curve/energy if present (resample to segment window)
    "tempo_curve": [
        {"t": round(e["t"] - start, 3), "bpm": e["bpm"]}
        for e in src.get("tempo_curve", [])
        if start <= e.get("t", -1) < end
    ],
    "parent": {
        "startSec": start,
        "endSec": end,
    },
}
with open("$SEG_DIR/beats.json", "w") as f:
    json.dump(out, f)
print(f"  beats: {len(out['beats'])} / downbeats: {len(out['downbeats'])} / drops: {len(out['drops'])} / breakdowns: {len(out['breakdowns'])}")
PYEOF

  # segment.json scaffold — matches segmentManifestSchema in
  # src/lib/schemas/segmentManifest.ts.
  if [[ ! -f "$SEG_DIR/segment.json" ]]; then
    python3 - <<PYEOF
import json
data = {
    "segmentName": "$NAME",
    "parentProject": "../../project.json",
    "timeRangeInParent": {
        "startSec": float($START),
        "endSec": float($END),
    },
    "localMedia": {
        "audio": "./audio.wav",
        "beats": "./beats.json",
    },
    "reason": "$REASON",
    "containsDrops": int("$DROPS") if "$DROPS" else 0,
    "containsBreakdowns": int("$BDS") if "$BDS" else 0,
}
import os
if os.path.exists("$SEG_DIR/video.mp4"):
    data["localMedia"]["video"] = "./video.mp4"
with open("$SEG_DIR/segment.json", "w") as f:
    json.dump(data, f, indent=2)
PYEOF
  fi
done

echo ""
echo "Done. $TOTAL segments written to $OUT_DIR"
