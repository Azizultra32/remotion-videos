"""Track-agnostic audit for the downbeat array in a beats JSON.

Runs four checks; exits 0 iff all pass, 1 otherwise. Prints a per-check
diagnostic so failures are actionable.

Checks
------
1. **Delta regularity.** Compute ``deltas[i] = D[i+1] - D[i]``.
   - ``stdev(deltas) / mean(deltas) < 0.05``  (bar length varies <5% —
     tight grid, no half-time regions)
   - ``max(deltas) / median(deltas) < 1.5``   (no outlier >=1.5× median —
     no "skipped bar" latches)

2. **Coverage.** ``len(D) >= 0.95 * duration / (60/bpm * 4)``. For a 4/4
   track at the reported tempo we expect one downbeat per bar across at
   least 95% of the track. Less than that means the detector missed
   bars (e.g. because it half-time-latched a long intro).

3. **Drops on downbeats.** Every entry in ``drops`` is within 0.1s of
   some downbeat — drops are supposed to be snapped to bar boundaries
   upstream, this verifies the snapping actually happened.

4. **Sanity.** ``duration > 0``, ``bpm_global > 0``, ``len(D) >= 2``.

Usage
-----
    python3 scripts/audit-downbeats.py public/love-in-traffic-beats.json
    python3 scripts/audit-downbeats.py public/dubfire-beats.json

Exit codes: 0 = all pass, 1 = at least one failure, 2 = I/O or shape error.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path


def audit(beats_json: str) -> list[str]:
    """Return a list of failure strings; empty list = all passed."""
    errors: list[str] = []
    path = Path(beats_json)
    name = path.name

    try:
        with open(path) as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        return [f"{name}: cannot read beats JSON: {exc}"]

    duration = float(data.get("duration", 0.0))
    bpm = float(data.get("bpm_global", 0.0))
    downbeats = [float(t) for t in data.get("downbeats", [])]
    drops = [float(t) for t in data.get("drops", [])]

    print(f"── audit: {name} ──")
    print(f"  duration={duration:.2f}s  bpm={bpm:.2f}  "
          f"downbeats={len(downbeats)}  drops={len(drops)}")

    # ── 4. Sanity ──────────────────────────────────────────────────────
    if duration <= 0:
        errors.append(f"{name}: duration is {duration}")
    if bpm <= 0:
        errors.append(f"{name}: bpm_global is {bpm}")
    if len(downbeats) < 2:
        errors.append(f"{name}: only {len(downbeats)} downbeats (need >= 2)")
        # Bail early — the other checks need a non-trivial array.
        return errors

    # ── 1. Delta regularity ────────────────────────────────────────────
    deltas = [downbeats[i + 1] - downbeats[i]
              for i in range(len(downbeats) - 1)]
    mean_d = statistics.mean(deltas)
    stdev_d = statistics.stdev(deltas) if len(deltas) > 1 else 0.0
    median_d = statistics.median(deltas)
    max_d = max(deltas)
    min_d = min(deltas)
    cov = stdev_d / mean_d if mean_d > 0 else float("inf")
    max_ratio = max_d / median_d if median_d > 0 else float("inf")

    print(f"  deltas: mean={mean_d:.4f}s  stdev={stdev_d:.4f}s  "
          f"median={median_d:.4f}s  min={min_d:.4f}s  max={max_d:.4f}s  "
          f"cov={cov:.4f}  max/median={max_ratio:.3f}")

    if cov >= 0.05:
        errors.append(
            f"{name}: delta coefficient of variation {cov:.4f} >= 0.05 "
            f"(mean={mean_d:.4f} stdev={stdev_d:.4f}) — downbeats are not "
            f"on a tight grid"
        )
    else:
        print(f"  ✓ delta CoV {cov:.4f} < 0.05")

    if max_ratio >= 1.5:
        # Find the offending delta for diagnostic.
        worst_idx = max(range(len(deltas)), key=lambda i: deltas[i])
        errors.append(
            f"{name}: max delta {max_d:.4f}s is {max_ratio:.3f}× the "
            f"median ({median_d:.4f}s) — looks like a half-time latch. "
            f"Worst delta at downbeat[{worst_idx}]→[{worst_idx + 1}]: "
            f"{downbeats[worst_idx]:.3f}s → {downbeats[worst_idx + 1]:.3f}s"
        )
    else:
        print(f"  ✓ max/median {max_ratio:.3f} < 1.5")

    # ── 2. Coverage ────────────────────────────────────────────────────
    expected_bar_sec = (60.0 / bpm) * 4.0 if bpm > 0 else 0.0
    expected_bars = duration / expected_bar_sec if expected_bar_sec > 0 else 0.0
    coverage_ratio = len(downbeats) / expected_bars if expected_bars > 0 else 0.0
    threshold = 0.95
    print(f"  coverage: expected ≈{expected_bars:.1f} bars at "
          f"{expected_bar_sec:.3f}s/bar, got {len(downbeats)} "
          f"(ratio={coverage_ratio:.3f})")
    if coverage_ratio < threshold:
        errors.append(
            f"{name}: downbeat count {len(downbeats)} is only "
            f"{coverage_ratio * 100:.1f}% of the expected {expected_bars:.0f} "
            f"bars at {bpm:.2f} BPM — below the 95% threshold (detector "
            f"likely dropped bars in a region)"
        )
    else:
        print(f"  ✓ coverage {coverage_ratio * 100:.1f}% >= 95%")

    # ── 3. Drops on downbeats ──────────────────────────────────────────
    drop_tol = 0.1
    bad_drops: list[tuple[int, float, float]] = []
    for i, d in enumerate(drops):
        near = min(downbeats, key=lambda t: abs(t - d))
        if abs(near - d) > drop_tol:
            bad_drops.append((i, d, near))
    if bad_drops:
        sample = ", ".join(
            f"drops[{i}]={d:.3f}s (nearest downbeat {n:.3f}s, Δ={abs(n - d):.3f}s)"
            for i, d, n in bad_drops[:3]
        )
        errors.append(
            f"{name}: {len(bad_drops)}/{len(drops)} drops more than "
            f"{drop_tol}s from nearest downbeat. First: {sample}"
        )
    else:
        print(f"  ✓ all {len(drops)} drops within {drop_tol}s of a downbeat")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("beats_json", nargs="+",
                        help="Path(s) to a beats.json file. Each is audited "
                        "independently; exit code reflects any failure.")
    args = parser.parse_args()

    all_errors: list[str] = []
    for p in args.beats_json:
        all_errors.extend(audit(p))
        print()

    if all_errors:
        print(f"✗ {len(all_errors)} failure(s):")
        for e in all_errors:
            print(f"   ✗ {e}")
        return 1
    print("✓ all downbeat audits passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
