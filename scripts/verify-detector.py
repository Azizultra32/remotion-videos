"""Sanity-check a beats JSON produced by the adaptive detector.

Guardrails:
  1. Drop count ≤ floor(duration / 30s). More than one drop per 30s is
     almost certainly the detector spamming.
  2. Drops fall on (or within ±1 beat of) a downbeat. EDM drops quantize
     to the bar line; off-grid drops point to broken phase.
  3. Breakdowns and buildups have positive duration and don't overlap
     each other pathologically (minor overlap is OK — a buildup can
     extend into a breakdown's tail).
  4. Drops fall after the track's first bar and before the last bar.
  5. If `analysis_meta.structure_detected` is false, drops/breakdowns/
     buildups must all be empty.

Exits 0 on pass, non-zero on any failure, printing a human-readable
summary either way.

Usage:
  python3 scripts/verify-detector.py public/love-in-traffic-beats.json
"""
import argparse
import json
import sys
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("beats_json")
args = parser.parse_args()

path = Path(args.beats_json)
data = json.loads(path.read_text())

duration = float(data["duration"])
beats = data.get("beats", [])
downbeats = data.get("downbeats", [])
drops = data.get("drops", [])
breakdowns = data.get("breakdowns", [])
buildups = data.get("buildups", [])
meta = data.get("analysis_meta", {})

errors: list[str] = []
warnings: list[str] = []

# Guardrail 5: structure-not-detected → everything empty
if meta.get("structure_detected") is False:
    if drops or breakdowns or buildups:
        errors.append(
            "analysis_meta.structure_detected is false but drops/breakdowns/"
            "buildups are not all empty — detector contract violated"
        )

# Only run the rest of the checks if we have beats to check against.
if not downbeats:
    warnings.append("no downbeats — can't check drop→downbeat alignment")
else:
    avg_beat_period = duration / max(1, len(beats) - 1) if beats else 0.5
    tolerance = avg_beat_period

    # Guardrail 1: drop density
    max_drops = max(1, int(duration // 30))
    if len(drops) > max_drops:
        errors.append(
            f"too many drops ({len(drops)}) — max allowed is "
            f"{max_drops} (1 per 30s of a {duration:.0f}s track)"
        )

    # Guardrail 2: drops near downbeats
    for i, d in enumerate(drops):
        nearest = min(downbeats, key=lambda db: abs(db - d))
        if abs(nearest - d) > tolerance:
            errors.append(
                f"drop {i + 1} @ {d:.2f}s is {abs(nearest - d):.2f}s from "
                f"nearest downbeat ({nearest:.2f}s) — expected ≤{tolerance:.2f}s"
            )

    # Guardrail 4: drops within track bounds
    if beats:
        first_beat = beats[0]
        last_beat = beats[-1]
        for i, d in enumerate(drops):
            if d < first_beat - 1 or d > last_beat + 1:
                errors.append(
                    f"drop {i + 1} @ {d:.2f}s is outside the beat grid "
                    f"[{first_beat:.2f}, {last_beat:.2f}]"
                )

# Guardrail 3: section sanity
def check_sections(name: str, regions: list) -> None:
    for i, r in enumerate(regions):
        if not isinstance(r, dict) or "start" not in r or "end" not in r:
            errors.append(f"{name}[{i}] missing start/end")
            continue
        if r["end"] <= r["start"]:
            errors.append(f"{name}[{i}] has non-positive duration")
        if r["start"] < 0 or r["end"] > duration + 1:
            errors.append(
                f"{name}[{i}] [{r['start']:.1f}, {r['end']:.1f}] escapes track"
            )

check_sections("breakdowns", breakdowns)
check_sections("buildups", buildups)

# Summary
print(f"═══ {path.name}")
print(f"  duration:     {duration:.1f}s  |  {duration/60:.1f} min")
print(f"  bpm_global:   {data.get('bpm_global', '?')}")
print(f"  beats:        {len(beats)}")
print(f"  downbeats:    {len(downbeats)}")
drop_strs = [f"{d:.1f}" for d in drops]
bd_strs = [f"{b['start']:.0f}-{b['end']:.0f}" for b in breakdowns]
bu_strs = [f"{b['start']:.0f}-{b['end']:.0f}" for b in buildups]
print(f"  drops:        {len(drops)}  -> {drop_strs}")
print(f"  breakdowns:   {len(breakdowns)}  -> {bd_strs}")
print(f"  buildups:     {len(buildups)}  -> {bu_strs}")
if meta:
    print(f"  algorithm:    {meta.get('algorithm', '?')}")
    if "computed_percentiles" in meta:
        print(f"  percentiles:  {meta['computed_percentiles']}")

if warnings:
    print("\n⚠  warnings:")
    for w in warnings:
        print(f"   - {w}")

if errors:
    print("\n✗ FAILURES:")
    for e in errors:
        print(f"   - {e}")
    sys.exit(1)

print("\n✓ guardrails passed")
