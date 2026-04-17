"""Adversarial audit harness for EDM structure detector output.

This is the companion to ``test-detector.py``. Where ``test-detector.py``
verifies *self-consistency* invariants (drops land on downbeats, breakdowns
inside [0, duration], etc.), ``audit-detector.py`` looks for *red flags* —
statistical signatures of upstream failure that self-consistency tests
would miss:

  T1  Downbeat grid regularity    — catches half-time / double-time latching
  T2  Bar-index ↔ wall-time       — catches off-by-N bar indexing
  T3  Breakdown width diversity   — catches synthetic / hard-coded durations
  T4  Unconfirmed peak placement  — catches prominence-too-low novelty floods
  T5  Drop phrase alignment       — catches drops that ignore 4/4 phrasing
  T6  Madmom half-time sanity     — catches bulk half-time latching via count

Every test is **track-agnostic**. No test encodes "love-in-traffic has 2 drops"
or similar. All checks are expressed as statistical / structural invariants
that any healthy detector output should satisfy.

Usage:
  python3 scripts/audit-detector.py public/love-in-traffic-beats.json
  python3 scripts/audit-detector.py public/dubfire-beats.json
  python3 scripts/audit-detector.py public/*-beats.json

Exit codes:
  0    all checks passed
  >0   at least one check failed (each is printed as "FAIL T<n>: <why>")
"""
from __future__ import annotations

import argparse
import json
import math
import statistics as st
import sys
from pathlib import Path
from typing import Any


# --------------------------------------------------------------------------- #
# Generic helpers
# --------------------------------------------------------------------------- #

def _fmt(x: float) -> str:
    return f"{x:.4f}"


def _median(xs: list[float]) -> float:
    return st.median(xs)


def _mean(xs: list[float]) -> float:
    return st.mean(xs) if xs else 0.0


def _stdev(xs: list[float]) -> float:
    return st.pstdev(xs) if len(xs) >= 2 else 0.0


# --------------------------------------------------------------------------- #
# T1 — Downbeat grid regularity
# --------------------------------------------------------------------------- #

def test_t1_downbeat_regularity(data: dict[str, Any]) -> list[str]:
    """Downbeats should land on a regular grid at bar_length = 60/bpm·4.

    Red flags:
      * stdev(deltas) / mean(deltas) >= 0.05  — drift / outliers
      * max(delta) / median(delta) >= 1.5     — at least one oversized gap
      * any delta > 2 × median                — half-time latching
      * any delta < 0.5 × median              — double-time latching
    """
    failures: list[str] = []
    downbeats = data.get("downbeats", [])
    if len(downbeats) < 3:
        return ["T1: fewer than 3 downbeats — cannot evaluate grid"]

    deltas = [downbeats[i + 1] - downbeats[i] for i in range(len(downbeats) - 1)]
    mean = _mean(deltas)
    median = _median(deltas)
    stdev = _stdev(deltas)

    cv = stdev / mean if mean else float("inf")
    if cv >= 0.05:
        failures.append(
            f"T1.cv: stdev/mean={cv:.4f} >= 0.05 "
            f"(mean={_fmt(mean)}, stdev={_fmt(stdev)}) — grid is irregular"
        )

    max_ratio = max(deltas) / median if median else float("inf")
    if max_ratio >= 1.5:
        failures.append(
            f"T1.max: max/median={max_ratio:.4f} >= 1.5 "
            f"(max={_fmt(max(deltas))}, median={_fmt(median)}) — oversized gap(s)"
        )

    half_time = [d for d in deltas if d > 2.0 * median]
    if half_time:
        sample = ", ".join(_fmt(x) for x in half_time[:5])
        failures.append(
            f"T1.half: {len(half_time)} delta(s) > 2×median "
            f"(median={_fmt(median)}; first={sample}) — half-time latching"
        )

    double_time = [d for d in deltas if d < 0.5 * median]
    if double_time:
        sample = ", ".join(_fmt(x) for x in double_time[:5])
        failures.append(
            f"T1.double: {len(double_time)} delta(s) < 0.5×median "
            f"(median={_fmt(median)}; first={sample}) — double-time latching"
        )

    return failures


# --------------------------------------------------------------------------- #
# T2 — Bar-index ↔ wall-time consistency
# --------------------------------------------------------------------------- #

def test_t2_bar_index_time_consistency(data: dict[str, Any]) -> list[str]:
    """``novelty_peaks_bars[i]`` must index a downbeat whose wall time is close
    to a real novelty event. We check the round-trip:

      forward:  bar_i -> downbeats[bar_i]  -> must equal reported wall time
                (when wall times are published; the current schema doesn't
                publish them for novelty, so this leg is a structural sanity
                check: the bar index must be in-range)
      backward: take downbeats[bar_i], find nearest downbeat to that time in
                the *grid*, confirm we recover bar_i. This is trivially true
                because we used the grid to produce the time — so the real
                check is that bar indices are all inside [0, len(downbeats)).
                If an agent tries to index an oversized bar array (because of
                a half-time intro where the code inflated `num_bars` from
                actual bar length rather than counting downbeats), this will
                catch it.

    Additional structural check: breakdown/buildup start/end times must each
    be within ±1 bar of an actual downbeat (consistent with downbeat-quantized
    boundaries). A mismatch of more than a few bars signals the boundary
    array was built against a different grid than was published.
    """
    failures: list[str] = []
    downbeats = data.get("downbeats", [])
    meta = data.get("analysis_meta", {}) or {}

    if not downbeats:
        return ["T2: no downbeats — cannot check bar-index consistency"]

    # Range check on novelty_peaks_bars
    peak_bars = meta.get("novelty_peaks_bars") or []
    for i, bar in enumerate(peak_bars):
        if not isinstance(bar, int):
            failures.append(f"T2.type: novelty_peaks_bars[{i}]={bar!r} not int")
            continue
        if bar < 0 or bar >= len(downbeats):
            failures.append(
                f"T2.range: novelty_peaks_bars[{i}]={bar} out of "
                f"[0, {len(downbeats)}) — bar index inconsistent with published grid"
            )

    # Range check on novelty_confirmed_bars
    confirmed_bars = meta.get("novelty_confirmed_bars") or []
    for i, bar in enumerate(confirmed_bars):
        if not isinstance(bar, int):
            failures.append(f"T2.type: novelty_confirmed_bars[{i}]={bar!r} not int")
            continue
        if bar < 0 or bar >= len(downbeats):
            failures.append(
                f"T2.range: novelty_confirmed_bars[{i}]={bar} out of "
                f"[0, {len(downbeats)}) — bar index inconsistent with published grid"
            )

    # Round-trip: each bar index, converted to time via downbeats[bar], should
    # map back to that same bar when we do a nearest-downbeat search.
    for i, bar in enumerate(peak_bars):
        if not isinstance(bar, int) or bar < 0 or bar >= len(downbeats):
            continue
        t = downbeats[bar]
        # Find nearest downbeat index to t
        recovered = min(range(len(downbeats)), key=lambda j: abs(downbeats[j] - t))
        if recovered != bar:
            failures.append(
                f"T2.roundtrip: novelty_peaks_bars[{i}]={bar} -> t={_fmt(t)} -> "
                f"nearest downbeat idx={recovered} (mismatch)"
            )

    # Boundary alignment: breakdown/buildup endpoints should be at or near a
    # downbeat (within 1 bar-length). If they're off by many bar-lengths, the
    # boundary detector was using a different grid than what was published.
    bpm_global = data.get("bpm_global")
    if bpm_global and bpm_global > 0:
        bar_len = 60.0 / float(bpm_global) * 4.0
        tol = 1.0 * bar_len  # 1 bar
        for label in ("breakdowns", "buildups"):
            for i, bd in enumerate(data.get(label) or []):
                for edge in ("start", "end"):
                    t = float(bd[edge])
                    nearest = min(downbeats, key=lambda d: abs(d - t))
                    gap = abs(nearest - t)
                    if gap > tol:
                        failures.append(
                            f"T2.boundary: {label}[{i}].{edge}={_fmt(t)} "
                            f"is {_fmt(gap)}s from nearest downbeat "
                            f"(>1 bar = {_fmt(tol)}s)"
                        )

    return failures


# --------------------------------------------------------------------------- #
# T3 — Breakdown width diversity
# --------------------------------------------------------------------------- #

def test_t3_breakdown_width_diversity(data: dict[str, Any]) -> list[str]:
    """Flag synthetic / hard-coded breakdown widths.

    Two checks:
      (a) Global: >50% of breakdowns clustered within 0.1s of each other.
      (b) Per-source: any breakdown source (e.g. ``novelty-new``) with >=2
          members where >=80% cluster within 0.1s. The ``novelty-new``
          breakdowns in particular get a hard-coded default width in the
          buggy detector; checking per-source catches this even when the
          mix of sources means the global-cluster-share is <50%.
    """
    failures: list[str] = []
    breakdowns = data.get("breakdowns") or []
    if len(breakdowns) < 2:
        return failures

    durations = [float(b["end"]) - float(b["start"]) for b in breakdowns]
    TOL = 0.1  # seconds

    def largest_cluster(vals: list[float]) -> tuple[int, float]:
        best_count = 0
        best_value = 0.0
        for v in vals:
            c = sum(1 for o in vals if abs(o - v) <= TOL)
            if c > best_count:
                best_count = c
                best_value = v
        return best_count, best_value

    # (a) Global check (only meaningful with >=3 breakdowns).
    if len(durations) >= 3:
        n, val = largest_cluster(durations)
        frac = n / len(durations)
        if frac > 0.5:
            failures.append(
                f"T3.global: {n}/{len(durations)} breakdowns ({frac:.0%}) "
                f"cluster at duration {_fmt(val)}s ±{TOL:.1f}s — "
                f"synthetic / hard-coded width signature"
            )

    # (b) Per-source check.
    meta = data.get("analysis_meta", {}) or {}
    sources = meta.get("breakdown_sources") or []
    if sources and len(sources) == len(durations):
        by_src: dict[str, list[float]] = {}
        for src, dur in zip(sources, durations):
            by_src.setdefault(src, []).append(dur)
        for src, durs in by_src.items():
            if len(durs) < 2:
                continue
            n, val = largest_cluster(durs)
            frac = n / len(durs)
            if frac >= 0.8:
                failures.append(
                    f"T3.by-source: {n}/{len(durs)} '{src}' breakdowns "
                    f"({frac:.0%}) clustered at {_fmt(val)}s ±{TOL:.1f}s — "
                    f"hard-coded-default signature for this source"
                )

    return failures


# --------------------------------------------------------------------------- #
# T4 — Unconfirmed novelty peaks in high-energy regions
# --------------------------------------------------------------------------- #

def test_t4_unconfirmed_peak_positioning(data: dict[str, Any]) -> list[str]:
    """Most unconfirmed novelty peaks should sit at plausible boundaries, not
    scatter through the energetic body of the track.

    We look up the energy at each unconfirmed peak's wall time (nearest-t
    entry in the published ``energy`` curve). If >30% land in the upper half
    (rel > 0.5), the prominence threshold is too low and novelty is firing on
    normal high-energy regions.
    """
    failures: list[str] = []
    meta = data.get("analysis_meta", {}) or {}
    peak_bars = meta.get("novelty_peaks_bars") or []
    confirmed_bars = set(meta.get("novelty_confirmed_bars") or [])
    downbeats = data.get("downbeats") or []
    energy = data.get("energy") or []

    if not peak_bars or not downbeats or not energy:
        return failures  # Not applicable.

    unconfirmed = [b for b in peak_bars if b not in confirmed_bars]
    if not unconfirmed:
        return failures

    hot = 0  # count of unconfirmed peaks in upper-half energy
    samples = []
    for bar in unconfirmed:
        if not isinstance(bar, int) or bar < 0 or bar >= len(downbeats):
            continue
        t = downbeats[bar]
        # nearest energy entry by time
        nearest = min(energy, key=lambda e: abs(float(e["t"]) - t))
        rel = float(nearest["rel"])
        samples.append((bar, t, rel))
        if rel > 0.5:
            hot += 1

    if not samples:
        return failures

    frac = hot / len(samples)
    if frac > 0.30:
        hot_detail = ", ".join(
            f"bar {b}@{_fmt(t)}s rel={_fmt(r)}"
            for b, t, r in samples if r > 0.5
        )
        failures.append(
            f"T4: {hot}/{len(samples)} unconfirmed novelty peaks "
            f"({frac:.0%}) in upper-half energy (rel>0.5). "
            f"Prominence threshold likely too low. Offenders: {hot_detail}"
        )

    return failures


# --------------------------------------------------------------------------- #
# T5 — Drop phrase alignment
# --------------------------------------------------------------------------- #

def test_t5_drop_phrase_alignment(data: dict[str, Any]) -> list[str]:
    """At least one drop should land within ±2 bars of a 16/32/64/128-bar
    phrase boundary, measured from the track's first "real" downbeat.

    "Real" downbeat = the first downbeat whose following delta is within 20%
    of the median delta. This skips half-time intros or outlier first bars.

    If no drops land on a phrase boundary, either (a) the downbeat grid is
    off (phrase math is computed against the wrong bar index), or (b) the
    drop placement is ignoring musical phrasing. Both are bugs.
    """
    failures: list[str] = []
    drops = data.get("drops") or []
    downbeats = data.get("downbeats") or []

    if not drops:
        return failures  # Zero drops is allowed.
    if len(downbeats) < 4:
        return failures  # Not enough grid to evaluate phrasing.

    deltas = [downbeats[i + 1] - downbeats[i] for i in range(len(downbeats) - 1)]
    median = _median(deltas)

    # Find first "real" downbeat — first index i where delta[i] is within 20%
    # of median (i.e., one bar, not half/double/outlier).
    first_real = 0
    for i, d in enumerate(deltas):
        if abs(d - median) / median <= 0.20:
            first_real = i
            break

    phrase_lengths = (16, 32, 64, 128)

    # For each drop, find its bar index relative to first_real.
    best_per_drop = []
    for drop_t in drops:
        # Nearest downbeat index
        nearest_bar = min(range(len(downbeats)), key=lambda j: abs(downbeats[j] - drop_t))
        rel_bar = nearest_bar - first_real
        # Find nearest multiple of any phrase length
        best_off = float("inf")
        best_phrase = None
        for plen in phrase_lengths:
            if rel_bar < 0:
                continue
            # distance to nearest multiple of plen (0, plen, 2*plen, ...)
            m = round(rel_bar / plen) * plen
            off = abs(rel_bar - m)
            if off < best_off:
                best_off = off
                best_phrase = plen
        best_per_drop.append((drop_t, rel_bar, best_phrase, best_off))

    # Pass if ANY drop lands within ±2 bars of a phrase multiple.
    any_aligned = any(off <= 2 for _, _, _, off in best_per_drop)
    if not any_aligned:
        detail = "; ".join(
            f"drop@{_fmt(t)}s (bar +{rb}) best-phrase {p}: off {o} bars"
            for t, rb, p, o in best_per_drop
        )
        failures.append(
            f"T5: no drop within ±2 bars of a 16/32/64/128-bar phrase "
            f"(first_real_bar={first_real}). {detail}"
        )

    return failures


# --------------------------------------------------------------------------- #
# T6 — Madmom half-time sanity (global count)
# --------------------------------------------------------------------------- #

def test_t6_madmom_halftime_sanity(data: dict[str, Any]) -> list[str]:
    """The reported downbeat count should be close to
    ``round(duration * bpm / 240)`` (since a bar = 4 beats at bpm BPM, and
    a minute has 60 seconds: bars = duration * bpm / 60 / 4 = d*bpm/240).

    Tolerance: ±5%. A ~50% shortfall signals madmom latched to half-time for
    the whole track. A ~100% excess signals double-time latching.
    """
    failures: list[str] = []
    duration = data.get("duration")
    bpm = data.get("bpm_global")
    downbeats = data.get("downbeats") or []

    if not duration or not bpm or not downbeats:
        return ["T6: duration / bpm_global / downbeats missing — cannot check"]

    expected = float(duration) * float(bpm) / 240.0
    actual = len(downbeats)
    if expected <= 0:
        return failures

    ratio = actual / expected
    # 5% tolerance
    if ratio < 0.95 or ratio > 1.05:
        mode = "half-time latched" if ratio < 0.75 else (
               "double-time latched" if ratio > 1.25 else
               "count off (>5%)")
        failures.append(
            f"T6: {actual} downbeats vs expected {expected:.1f} "
            f"(ratio={ratio:.3f}) — {mode}. "
            f"duration={duration}s bpm_global={bpm}"
        )

    return failures


# --------------------------------------------------------------------------- #
# Driver
# --------------------------------------------------------------------------- #

def test_t7_buildup_breakdown_disjoint(data: dict) -> list[str]:
    """Buildups and breakdowns must not overlap. A buildup is a riser
    section that leads INTO a drop — it's a different kind of section
    from a breakdown. Simultaneous "breaking down AND building up" is
    contradictory and usually means a gradual intro was double-classified.
    Tolerate up to 20% overlap (risers sometimes nudge into the trailing
    edge of a breakdown) but flag anything higher."""
    failures: list[str] = []
    breakdowns = data.get("breakdowns", [])
    buildups = data.get("buildups", [])
    for i, bu in enumerate(buildups):
        bu_len = bu["end"] - bu["start"]
        if bu_len <= 0:
            continue
        overlap = 0.0
        worst_bd = None
        worst_overlap = 0.0
        for bd in breakdowns:
            lo = max(bu["start"], bd["start"])
            hi = min(bu["end"], bd["end"])
            if hi > lo:
                overlap += hi - lo
                if hi - lo > worst_overlap:
                    worst_overlap = hi - lo
                    worst_bd = bd
        frac = overlap / bu_len
        if frac > 0.20:
            bd_str = f"[{worst_bd['start']:.1f}, {worst_bd['end']:.1f}]" if worst_bd else "?"
            failures.append(
                f"T7: buildups[{i}] {bu_len:.1f}s overlaps breakdowns by "
                f"{frac*100:.0f}% (worst: {bd_str}) — buildup + breakdown "
                "are mutually exclusive by definition"
            )
    return failures


TESTS = [
    ("T1 downbeat grid regularity", test_t1_downbeat_regularity),
    ("T2 bar-index ↔ time consistency", test_t2_bar_index_time_consistency),
    ("T3 breakdown width diversity", test_t3_breakdown_width_diversity),
    ("T4 unconfirmed novelty peak positioning", test_t4_unconfirmed_peak_positioning),
    ("T5 drop phrase alignment", test_t5_drop_phrase_alignment),
    ("T6 madmom half-time sanity", test_t6_madmom_halftime_sanity),
    ("T7 buildup/breakdown disjoint", test_t7_buildup_breakdown_disjoint),
]


def audit(path: Path) -> int:
    """Run all audit checks on one beats JSON. Returns number of failures."""
    print(f"=== {path} ===")
    try:
        data = json.loads(path.read_text())
    except Exception as e:
        print(f"FAIL load: could not read/parse: {e}")
        return 1

    total = 0
    for label, fn in TESTS:
        try:
            failures = fn(data)
        except Exception as e:
            print(f"FAIL {label}: exception {type(e).__name__}: {e}")
            total += 1
            continue
        if not failures:
            print(f"PASS {label}")
        else:
            for f in failures:
                print(f"FAIL {label}: {f}")
            total += len(failures)
    print(f"--- {total} failure(s) ---")
    print()
    return total


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Adversarial audit for beats JSON output.")
    ap.add_argument("paths", nargs="+", help="Paths to *-beats.json files")
    args = ap.parse_args(argv)

    total = 0
    for s in args.paths:
        total += audit(Path(s))
    if total:
        print(f"AUDIT FAILED: {total} failure(s) across {len(args.paths)} file(s)")
        return 1
    print(f"AUDIT PASSED: {len(args.paths)} file(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
