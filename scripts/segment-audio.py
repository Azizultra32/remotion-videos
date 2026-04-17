"""Segment a long DJ mix into workable chunks.

Reads a beats.json (from detect-beats.py / detect-drops.py) and emits a
segments.json with natural section boundaries based on drops, breakdowns,
and optional librosa structural segmentation when the audio is available.

Output: projects/<name>/segments.json or public/<prefix>-segments.json
{
  "source": "dubfire-sake.wav",
  "duration": 7321.112,
  "segments": [
    {
      "name": "00-intro",
      "startSec": 0.0,
      "endSec": 234.5,
      "reason": "pre-first-drop",
      "containsDrops": 0,
      "containsBreakdowns": 1
    },
    ...
  ]
}

Usage:
  python3 scripts/segment-audio.py \\
    --beats public/dubfire-beats.json \\
    --out   public/dubfire-segments.json \\
    [--audio out/dubfire-sake.wav]        # optional, enables librosa structural
    [--min-len 30] [--max-len 180]        # segment length bounds in seconds
    [--pre-buffer 8] [--post-buffer 24]   # drop context window
"""
import argparse
import json
import os
import sys
from typing import Optional


def load_beats(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


def optional_librosa_boundaries(audio_path: str, duration: float) -> list:
    """Use librosa's agglomerative segmentation if available. Returns list of
    boundary times in seconds, or [] if librosa isn't installed / audio can't
    be read. Fail-soft: this is enrichment, not required."""
    try:
        import numpy as np
        import librosa
    except ImportError:
        print("  (librosa unavailable, skipping structural segmentation)", flush=True)
        return []
    try:
        print(f"  Loading audio {audio_path} for structural segmentation...", flush=True)
        y, sr = librosa.load(audio_path, sr=22050, mono=True)
        # Chroma + MFCC features, agglomerative clustering.
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=2048)
        n_clusters = max(4, min(40, int(duration / 60)))  # 4-40 sections
        boundaries = librosa.segment.agglomerative(chroma, n_clusters)
        boundary_times = librosa.frames_to_time(boundaries, sr=sr, hop_length=2048)
        print(f"  Found {len(boundary_times)} librosa structural boundaries", flush=True)
        return sorted(float(t) for t in boundary_times)
    except Exception as e:
        print(f"  (librosa segmentation failed: {e})", flush=True)
        return []


def dedupe_sorted(vals: list, min_gap: float) -> list:
    """Keep first occurrence; drop any value within min_gap of the previous."""
    out = []
    for v in vals:
        if not out or (v - out[-1]) >= min_gap:
            out.append(v)
    return out


def split_long(segments: list, max_len: float) -> list:
    """If any segment exceeds max_len, subdivide it into equal chunks <= max_len."""
    out = []
    for seg in segments:
        length = seg["endSec"] - seg["startSec"]
        if length <= max_len:
            out.append(seg)
            continue
        n_chunks = int(length / max_len) + 1
        chunk_len = length / n_chunks
        for i in range(n_chunks):
            start = seg["startSec"] + i * chunk_len
            end = seg["endSec"] if i == n_chunks - 1 else seg["startSec"] + (i + 1) * chunk_len
            out.append({
                **seg,
                "startSec": round(start, 4),
                "endSec": round(end, 4),
                "reason": f"{seg['reason']}+subdivided",
            })
    return out


def name_segment(idx: int, seg: dict, total: int) -> str:
    """Produce a numeric-prefixed slug name. '00-intro', '03-first-drop', etc."""
    width = max(2, len(str(total - 1)))
    prefix = f"{idx:0{width}d}"
    reason = seg["reason"].split("+")[0]
    if "drop" in reason:
        return f"{prefix}-drop"
    if "breakdown" in reason:
        return f"{prefix}-breakdown"
    if "intro" in reason:
        return f"{prefix}-intro"
    if "outro" in reason:
        return f"{prefix}-outro"
    if "librosa" in reason:
        return f"{prefix}-section"
    return f"{prefix}-segment"


def build_segments(
    beats: dict,
    audio_path: Optional[str],
    min_len: float,
    max_len: float,
    pre_buffer: float,
    post_buffer: float,
) -> list:
    duration = float(beats["duration"])
    drops = sorted(float(t) for t in beats.get("drops", []))
    breakdowns = beats.get("breakdowns", [])

    # Candidate boundaries: 0, each drop (minus pre_buffer start / plus post_buffer end),
    # each breakdown start/end, and duration.
    boundaries = [0.0, duration]
    for t in drops:
        boundaries.append(max(0.0, t - pre_buffer))
        boundaries.append(min(duration, t + post_buffer))
    for bd in breakdowns:
        if isinstance(bd, dict):
            if "start" in bd:
                boundaries.append(float(bd["start"]))
            if "end" in bd:
                boundaries.append(float(bd["end"]))

    # Enrich with librosa structural boundaries if audio is available.
    if audio_path and os.path.exists(audio_path):
        boundaries.extend(optional_librosa_boundaries(audio_path, duration))

    # Sort, dedupe by min_len gap, clip to [0, duration].
    boundaries = sorted(b for b in boundaries if 0.0 <= b <= duration)
    boundaries = dedupe_sorted(boundaries, min_len)

    # Build segments between consecutive boundaries, tagging each with a reason.
    segments = []
    for i in range(len(boundaries) - 1):
        start = boundaries[i]
        end = boundaries[i + 1]
        contains_drops = sum(1 for t in drops if start <= t < end)
        contains_breakdowns = sum(
            1 for bd in breakdowns
            if isinstance(bd, dict)
            and start <= float(bd.get("start", -1)) < end
        )

        if start == 0.0:
            reason = "intro"
        elif end == duration:
            reason = "outro"
        elif contains_drops > 0:
            reason = "drop-region"
        elif contains_breakdowns > 0:
            reason = "breakdown"
        else:
            reason = "regular"

        segments.append({
            "startSec": round(start, 4),
            "endSec": round(end, 4),
            "reason": reason,
            "containsDrops": contains_drops,
            "containsBreakdowns": contains_breakdowns,
        })

    # Split any segments longer than max_len.
    segments = split_long(segments, max_len)

    # Assign names.
    total = len(segments)
    for i, seg in enumerate(segments):
        seg["name"] = name_segment(i, seg, total)

    return segments


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--beats", required=True, help="Path to beats.json")
    ap.add_argument("--out", required=True, help="Path to write segments.json")
    ap.add_argument("--audio", default=None, help="Optional source audio for librosa structural segmentation")
    ap.add_argument("--min-len", type=float, default=30.0, help="Minimum segment length in seconds (default 30)")
    ap.add_argument("--max-len", type=float, default=180.0, help="Maximum segment length in seconds (default 180)")
    ap.add_argument("--pre-buffer", type=float, default=8.0, help="Seconds before a drop that count as drop context (default 8)")
    ap.add_argument("--post-buffer", type=float, default=24.0, help="Seconds after a drop that count as drop context (default 24)")
    args = ap.parse_args()

    if not os.path.exists(args.beats):
        print(f"ERROR: beats file not found: {args.beats}", file=sys.stderr)
        sys.exit(1)

    print(f"Loading beats: {args.beats}", flush=True)
    beats = load_beats(args.beats)
    print(f"  duration={beats.get('duration'):.1f}s  drops={len(beats.get('drops', []))}  breakdowns={len(beats.get('breakdowns', []))}", flush=True)

    print("Building segments...", flush=True)
    segments = build_segments(
        beats,
        audio_path=args.audio,
        min_len=args.min_len,
        max_len=args.max_len,
        pre_buffer=args.pre_buffer,
        post_buffer=args.post_buffer,
    )
    print(f"  produced {len(segments)} segments", flush=True)

    out = {
        "source": os.path.basename(args.audio) if args.audio else None,
        "duration": float(beats["duration"]),
        "segments": segments,
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(out, f, indent=2)
    print(f"Wrote {args.out}", flush=True)

    # Summary.
    print("\nSummary:")
    for seg in segments[:5]:
        print(f"  {seg['name']:22s}  {seg['startSec']:8.2f} → {seg['endSec']:8.2f}  ({seg['endSec']-seg['startSec']:6.2f}s)  {seg['reason']}")
    if len(segments) > 10:
        print(f"  ... ({len(segments)-10} more) ...")
        for seg in segments[-5:]:
            print(f"  {seg['name']:22s}  {seg['startSec']:8.2f} → {seg['endSec']:8.2f}  ({seg['endSec']-seg['startSec']:6.2f}s)  {seg['reason']}")


if __name__ == "__main__":
    main()
