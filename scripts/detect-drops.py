"""Track-agnostic EDM structure detector (percentile+novelty).

Replaces the legacy absolute-dB detector. All thresholds are derived from
per-track percentiles of banded RMS aggregated per-bar using the beat grid
produced by detect-beats.py — so the detector self-calibrates to any mix.

Two structural signals are combined:

  Signal A — "adaptive percentile" (v2):
    HIGHS+AIR energy dropping below struct_p25 for >=8 bars. Fires on
    breakdowns where hats/pads/leads strip out. Robust on deep/minimal
    tracks that keep bass running through the breakdown.

  Signal B — "Foote novelty" (2026-04-17 extension):
    MFCC per-bar → self-similarity matrix → checkerboard-kernel novelty
    curve → scipy.signal.find_peaks. Peaks mark bars where timbre
    changes abruptly (section boundaries). Based on Foote 2000,
    "Automatic audio segmentation using a measure of audio novelty
    score." Industry-standard boundary detector. MFCC captures timbral
    similarity: two bars that "sound the same" score high on the SSM.

Merge strategy (percentile is truth, novelty adds coverage):
  - Keep all percentile-detected breakdowns.
  - Each novelty peak within +/-4 bars of a percentile breakdown is
    "confirmed-by-both" (recorded in analysis_meta, does not add a
    new breakdown).
  - Each novelty peak NOT near any percentile breakdown gets emitted
    as a 4-bar breakdown at [peak, peak+4) iff the surrounding window
    [peak-2, peak+6) averages at or below struct_p50. This avoids
    flagging loud transitions (those are drops, not breakdowns).
  - Final breakdown list is sorted by start time and overlapping
    ranges are merged.

Algorithm summary:
  1. Banded RMS: bass (80-250 Hz), highs (2k-8k), air (8k+).
  2. Per-bar aggregation (median) between consecutive downbeats.
  3. Primary curve: struct_per_bar = dB(highs + air) per bar.
  4. Percentiles on struct: struct_p25 ("stripped down") and struct_p70 ("full").
  5. Guardrail: if struct_p70 - struct_p25 < 6 dB, the track has no
     meaningful structure — emit empty lists and a warning.
  6. Breakdown_percentile: >=8 consecutive bars at or below struct_p25.
  7. Buildup: >=4 consecutive bars where struct_per_bar slope is positive
     AND bass is flat / below bass_p50. The classic riser pattern.
  8. Drop: single downbeat timestamp — first bar after a breakdown/buildup
     where BOTH struct_per_bar >= struct_p70 AND bass_per_bar >= bass_p50
     (the full mix comes back, not just hats). Dedupe within 1 bar, cap
     at floor(dur/30).
  9. MFCC (13 coeff) per-bar → cosine SSM → Foote novelty with 2N=16-bar
     Gaussian checkerboard → scipy find_peaks (min-distance 8 bars).
 10. Merge novelty peaks into breakdowns per the rules above.
 11. Energy: struct_per_bar stored as percentile rank in [0, 1] per bar.

Augments the input beats JSON in place. Existing `drops`, `breakdowns`,
`energy` keys are retained (types preserved). Legacy `silences` and
`drop_detection` keys are removed.
"""
import argparse
import json
import os

import librosa
import numpy as np
from scipy.signal import find_peaks

from track_config import load_config

parser = argparse.ArgumentParser()
parser.add_argument("--audio", required=True)
parser.add_argument("--beats-json", required=True,
                    help="Path to beats JSON (will be augmented in place)")
parser.add_argument("--min-breakdown-bars", type=int, default=8,
                    help="Minimum contiguous bars below struct_p25 to call a "
                    "breakdown (default 8 ≈ 15s at 128 BPM).")
parser.add_argument("--min-buildup-bars", type=int, default=4,
                    help="Minimum contiguous bars of rising HF slope with "
                    "flat bass to call a buildup (default 4 ≈ 7.5s at 128 BPM).")
parser.add_argument("--novelty-kernel-bars", type=int, default=8,
                    help="Foote novelty half-kernel size N (full kernel is "
                    "2N x 2N, default N=8 → 16-bar context window).")
parser.add_argument("--novelty-min-distance-bars", type=int, default=8,
                    help="Minimum bar-distance between novelty peaks (default 8).")
parser.add_argument("--novelty-confirm-tolerance-bars", type=int, default=4,
                    help="A novelty peak within +/-N bars of a percentile "
                    "breakdown is 'confirmed-by-both' (default 4).")
parser.add_argument("--config", default=None,
                    help="Optional per-track config JSON; `drops` section "
                    "overrides CLI defaults. See docs/track-config-schema.md.")
args = parser.parse_args()
AUDIO = args.audio
BEATS_JSON = args.beats_json

cfg = load_config(args.config, "drops")

BASS_BAND_HZ = tuple(cfg.get("bass_band_hz", [80.0, 250.0]))
HIGHS_BAND_HZ = tuple(cfg.get("highs_band_hz", [2000.0, 8000.0]))
AIR_BAND_HZ = tuple(cfg.get("air_band_hz", [8000.0, 16000.0]))

BARS_PER_BREAKDOWN_MIN = int(cfg.get("bars_per_breakdown_min", args.min_breakdown_bars))
BARS_PER_BUILDUP_MIN = int(cfg.get("bars_per_buildup_min", args.min_buildup_bars))
STRUCTURE_DELTA_DB_MIN = float(cfg.get("structure_delta_db_min", 6.0))
DROP_DEDUPE_BARS = 1

NOVELTY_KERNEL_BARS = int(cfg.get("novelty_kernel_bars", args.novelty_kernel_bars))
NOVELTY_MIN_DISTANCE_BARS = int(cfg.get("novelty_peak_min_distance_bars", args.novelty_min_distance_bars))
NOVELTY_CONFIRM_TOLERANCE_BARS = int(args.novelty_confirm_tolerance_bars)
# Prominence filters out noise peaks in the normalized [0,1] novelty curve.
# 0.05 was empirically too permissive (audit T4 saw 44% of unconfirmed peaks
# in high-energy regions — over-fitting to micro-variations). 0.15 cuts the
# obvious noise without throwing away real boundaries.
NOVELTY_PROMINENCE = float(cfg.get("novelty_prominence", 0.50))
# Max bars a novelty-new breakdown can extend. Old code emitted fixed 4-bar
# ranges; audit T3 flagged that 100% had identical 7.45s width — an artifact
# signature. The variable-width extender below will stop earlier if energy
# returns. The cap is here as a safety net for tracks where energy stays low.
NOVELTY_NEW_BREAKDOWN_BARS_MAX = 16

STRUCT_PCTS = cfg.get("struct_percentiles", [25, 50, 70])
NOVELTY_ENERGY_WINDOW = (-2, 6)  # [peak-2, peak+6) must be <= struct_p50


def db(x: np.ndarray) -> np.ndarray:
    return 20.0 * np.log10(np.asarray(x) + 1e-12)


def band_rms(S: np.ndarray, freqs: np.ndarray, lo_hz: float, hi_hz: float) -> np.ndarray:
    mask = (freqs >= lo_hz) & (freqs < hi_hz)
    if mask.sum() == 0:
        return np.zeros(S.shape[1])
    return np.sqrt(np.mean(S[mask, :] ** 2, axis=0))


def aggregate_per_bar(curve: np.ndarray, frame_times: np.ndarray,
                      downbeats: list[float], duration: float) -> np.ndarray:
    # Each bar spans [downbeats[i], downbeats[i+1]); the final bar ends at duration.
    bar_edges = list(downbeats) + [float(duration)]
    out = np.empty(len(downbeats))
    for i in range(len(downbeats)):
        lo, hi = bar_edges[i], bar_edges[i + 1]
        lo_idx = int(np.searchsorted(frame_times, lo, side="left"))
        hi_idx = int(np.searchsorted(frame_times, hi, side="left"))
        if hi_idx <= lo_idx:
            # Bar shorter than one STFT hop — fall back to nearest frame.
            hi_idx = min(lo_idx + 1, len(curve))
            lo_idx = max(hi_idx - 1, 0)
        segment = curve[lo_idx:hi_idx]
        out[i] = float(np.median(segment)) if segment.size else 0.0
    return out


def runs_where(mask: np.ndarray, min_len: int) -> list[tuple[int, int]]:
    runs = []
    i = 0
    n = len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j < n and mask[j]:
                j += 1
            if j - i >= min_len:
                runs.append((i, j - 1))
            i = j
        else:
            i += 1
    return runs


def percentile_rank(values: np.ndarray) -> np.ndarray:
    # Returns rank in [0, 1] where 0=min, 1=max (ties → average rank).
    order = np.argsort(values)
    ranks = np.empty_like(order, dtype=float)
    ranks[order] = np.arange(len(values))
    n = max(1, len(values) - 1)
    return ranks / n


def aggregate_mfcc_per_bar(mfcc: np.ndarray, frame_times: np.ndarray,
                           downbeats: list[float], duration: float) -> np.ndarray:
    """Median MFCC vector per bar. mfcc shape = (n_coeff, n_frames)."""
    bar_edges = list(downbeats) + [float(duration)]
    n_coeff = mfcc.shape[0]
    out = np.zeros((len(downbeats), n_coeff), dtype=float)
    for i in range(len(downbeats)):
        lo, hi = bar_edges[i], bar_edges[i + 1]
        lo_idx = int(np.searchsorted(frame_times, lo, side="left"))
        hi_idx = int(np.searchsorted(frame_times, hi, side="left"))
        if hi_idx <= lo_idx:
            hi_idx = min(lo_idx + 1, mfcc.shape[1])
            lo_idx = max(hi_idx - 1, 0)
        segment = mfcc[:, lo_idx:hi_idx]
        if segment.shape[1] == 0:
            continue
        out[i, :] = np.median(segment, axis=1)
    return out


def cosine_ssm(features: np.ndarray) -> np.ndarray:
    """Self-similarity matrix via cosine similarity. features shape = (n_bars, n_coeff).
    Returns (n_bars, n_bars) in [-1, 1]."""
    norms = np.linalg.norm(features, axis=1, keepdims=True)
    norms = np.where(norms < 1e-12, 1.0, norms)
    unit = features / norms
    return unit @ unit.T


def foote_checkerboard_kernel(n: int) -> np.ndarray:
    """Foote 2000 2N x 2N Gaussian-tapered checkerboard kernel.

    The kernel has +1 on the top-left and bottom-right quadrants (self-similarity
    before/after the boundary) and -1 on the top-right/bottom-left (cross-similarity
    across the boundary). A low-value response at a diagonal point means "bar
    before here looks like bar after here" → no boundary. A high response
    means "bar before here does NOT look like bar after here" → boundary.
    The Gaussian taper weights the response toward the center of the kernel.
    """
    size = 2 * n
    # Coordinates centered at the boundary (between index n-1 and n).
    idx = np.arange(size, dtype=float) - (n - 0.5)
    x = idx[:, None]
    y = idx[None, :]
    # Sign: +1 if (x<0,y<0) or (x>0,y>0); -1 otherwise (the checkerboard).
    sign = np.sign(x) * np.sign(y)
    # Gaussian taper. sigma = n/2 puts most weight near the center boundary.
    sigma = max(n / 2.0, 1.0)
    gauss = np.exp(-(x ** 2 + y ** 2) / (2.0 * sigma ** 2))
    kernel = sign * gauss
    return kernel


def foote_novelty(ssm: np.ndarray, kernel: np.ndarray) -> np.ndarray:
    """Slide the checkerboard kernel along the diagonal of the SSM.

    At each center bar c, overlay the 2N x 2N kernel centered on (c, c) and
    compute the element-wise sum of (kernel * ssm_patch). Out-of-bounds
    elements are treated as zero (via clipped indexing). Normalized to [0, 1].
    """
    n_bars = ssm.shape[0]
    size = kernel.shape[0]
    half = size // 2
    novelty = np.zeros(n_bars, dtype=float)
    # Pad SSM with zeros so boundary bars still get a valid patch.
    padded = np.zeros((n_bars + size, n_bars + size), dtype=float)
    padded[half:half + n_bars, half:half + n_bars] = ssm
    for c in range(n_bars):
        patch = padded[c:c + size, c:c + size]
        novelty[c] = float(np.sum(patch * kernel))
    # Normalize to [0, 1] for stable peak thresholding.
    lo = float(novelty.min())
    hi = float(novelty.max())
    if hi - lo > 1e-12:
        novelty = (novelty - lo) / (hi - lo)
    else:
        novelty = np.zeros_like(novelty)
    return novelty


def merge_overlapping_ranges(ranges: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Merge overlapping/touching [start, end] ranges. Input is list of (s, e).

    Ranges that touch (e1 == s2) or overlap are merged into one."""
    if not ranges:
        return []
    ranges = sorted(ranges, key=lambda r: (r[0], r[1]))
    merged = [ranges[0]]
    for s, e in ranges[1:]:
        ps, pe = merged[-1]
        if s <= pe:
            merged[-1] = (ps, max(pe, e))
        else:
            merged.append((s, e))
    return merged


print("Loading audio...", flush=True)
y, sr = librosa.load(AUDIO, sr=22050, mono=True)
duration = float(librosa.get_duration(y=y, sr=sr))
print(f"Duration: {duration:.1f}s ({duration / 60:.1f} min)", flush=True)

with open(BEATS_JSON) as f:
    data = json.load(f)

beats = list(data.get("beats", []))
downbeats = list(data.get("downbeats", []))
if not downbeats or len(downbeats) < 4:
    raise SystemExit(
        f"detect-drops: need downbeats in {BEATS_JSON} (found {len(downbeats)}). "
        "Run detect-beats.py first.")

n_fft = 4096
hop = 1024  # ~46 ms at 22050 — plenty for per-bar aggregation.
print("Computing STFT...", flush=True)
S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop))
freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
frame_times = librosa.frames_to_time(np.arange(S.shape[1]), sr=sr, hop_length=hop)

print("Computing banded RMS (bass / highs / air)...", flush=True)
bass_curve = band_rms(S, freqs, *BASS_BAND_HZ)
highs_curve = band_rms(S, freqs, *HIGHS_BAND_HZ)
air_curve = band_rms(S, freqs, *AIR_BAND_HZ)

print("Aggregating per bar...", flush=True)
bass_per_bar_lin = aggregate_per_bar(bass_curve, frame_times, downbeats, duration)
highs_per_bar_lin = aggregate_per_bar(highs_curve, frame_times, downbeats, duration)
air_per_bar_lin = aggregate_per_bar(air_curve, frame_times, downbeats, duration)

bass_per_bar = db(bass_per_bar_lin)
struct_per_bar = db(highs_per_bar_lin + air_per_bar_lin)
num_bars = len(bass_per_bar)
print(f"Bars: {num_bars}", flush=True)

# p25/p70 brackets "stripped down" and "full mix" sections for a single
# EDM track. Long DJ mixes need wider percentiles, but they're not the
# target — single-track structure is.
struct_p25 = float(np.percentile(struct_per_bar, STRUCT_PCTS[0]))
struct_p50 = float(np.percentile(struct_per_bar, STRUCT_PCTS[1]))
struct_p70 = float(np.percentile(struct_per_bar, STRUCT_PCTS[2]))
bass_p25 = float(np.percentile(bass_per_bar, 25))
bass_p50 = float(np.percentile(bass_per_bar, 50))
bass_p70 = float(np.percentile(bass_per_bar, 70))
structure_delta = struct_p70 - struct_p25
structure_detected = structure_delta >= STRUCTURE_DELTA_DB_MIN

print(f"struct_p25 (highs+air) = {struct_p25:.2f} dB", flush=True)
print(f"struct_p50              = {struct_p50:.2f} dB", flush=True)
print(f"struct_p70              = {struct_p70:.2f} dB", flush=True)
print(f"bass_p50                = {bass_p50:.2f} dB", flush=True)
print(f"delta                   = {structure_delta:.2f} dB "
      f"({'structure detected' if structure_detected else 'NO STRUCTURE — empty outputs'})",
      flush=True)

# One bar length, averaged — used for offsetting breakdown ends and drop caps.
bar_lengths = np.diff(list(downbeats) + [duration])
mean_bar_sec = float(np.mean(bar_lengths)) if bar_lengths.size else 2.0

breakdowns: list[dict] = []
# Parallel bookkeeping: for each final breakdown, the source that generated it
# ("percentile", "novelty-new", or "confirmed-by-both"). Kept in sync with
# `breakdowns` via index after the merge.
breakdown_sources: list[str] = []
# The percentile pass builds its own list first so we can keep a pristine
# count for novelty agreement checks.
percentile_breakdowns: list[dict] = []
percentile_breakdown_bars: list[tuple[int, int]] = []  # (start_bar, end_bar_exclusive)
buildups: list[dict] = []
drops_sec: list[float] = []

def _snap_end_to_grid(end_bar: int) -> float:
    """Return breakdown end time snapped to the downbeat grid.

    Old code used `downbeats[end_bar] + mean_bar_sec` when the breakdown
    ran to the last bar, which drifts off-grid (audit T2 fired on this).
    Now: always snap to a downbeat — use `downbeats[end_bar+1]` if in
    range, else `downbeats[-1]` as the terminal boundary (the last real
    downbeat IS a grid point, unlike `duration`)."""
    if end_bar + 1 < len(downbeats):
        return float(downbeats[end_bar + 1])
    return float(downbeats[-1])


if structure_detected:
    breakdown_mask = struct_per_bar <= struct_p25
    for start_bar, end_bar in runs_where(breakdown_mask, BARS_PER_BREAKDOWN_MIN):
        start_t = float(downbeats[start_bar])
        end_t = _snap_end_to_grid(end_bar)
        percentile_breakdowns.append({"start": round(start_t, 3), "end": round(end_t, 3)})
        percentile_breakdown_bars.append((start_bar, end_bar + 1))
    # Retain old variable name for the legacy drop-finding pass below.
    breakdowns = list(percentile_breakdowns)

    # Buildup: sustained positive HF slope with flat/low bass. Use a 4-bar
    # window to smooth slope estimation and require bass_per_bar <= p50.
    def rolling_slope(x: np.ndarray, window: int) -> np.ndarray:
        n = len(x)
        out = np.zeros(n)
        half = window // 2
        for i in range(n):
            a = max(0, i - half)
            b = min(n, i + half + 1)
            seg = x[a:b]
            if len(seg) < 2:
                continue
            t = np.arange(len(seg), dtype=float)
            # Least-squares slope.
            slope = np.polyfit(t, seg, 1)[0]
            out[i] = slope
        return out

    struct_slope = rolling_slope(struct_per_bar, window=BARS_PER_BUILDUP_MIN)
    buildup_mask = (struct_slope > 0) & (bass_per_bar <= bass_p50)
    for start_bar, end_bar in runs_where(buildup_mask, BARS_PER_BUILDUP_MIN):
        start_t = float(downbeats[start_bar])
        end_t = _snap_end_to_grid(end_bar)
        buildups.append({"start": round(start_t, 3), "end": round(end_t, 3)})

    def first_loud_bar_after(bar_idx: int) -> int | None:
        # Drop = full mix returns: hats/air up AND bass present.
        for k in range(bar_idx, num_bars):
            if struct_per_bar[k] >= struct_p70 and bass_per_bar[k] >= bass_p50:
                return k
        return None

    # EDM phrase structure is quantized to 16-bar multiples. Search in a
    # window around the raw "first loud bar" candidate for a bar that is
    # BOTH loud AND sits on a 16/32/64/128-bar boundary. Prefer the nearest
    # phrase-aligned loud bar over the strict first-loud-bar — drops
    # audibly land on phrase boundaries in 4/4 EDM, and a few bars of
    # tolerance here materially improves alignment. If no phrase-aligned
    # loud bar exists in the window, keep the raw candidate.
    PHRASE_LENGTHS = (16, 32, 64, 128)
    PHRASE_SEARCH_BARS = 12

    def _bar_is_loud(k: int) -> bool:
        return (0 <= k < num_bars
                and struct_per_bar[k] >= struct_p70
                and bass_per_bar[k] >= bass_p50)

    def _bar_is_phrase_aligned(k: int) -> bool:
        return any(k % phrase == 0 for phrase in PHRASE_LENGTHS)

    def _snap_to_phrase(bar_idx: int) -> int:
        # Prefer the closest phrase-aligned loud bar within ±PHRASE_SEARCH_BARS.
        # Scan outward from bar_idx so ties are broken by proximity.
        for delta in range(PHRASE_SEARCH_BARS + 1):
            for k in (bar_idx - delta, bar_idx + delta):
                if _bar_is_phrase_aligned(k) and _bar_is_loud(k):
                    return k
        return bar_idx

    candidate_bars: list[int] = []
    for bd in breakdowns:
        end_bar_idx = int(np.searchsorted(downbeats, bd["end"], side="left"))
        k = first_loud_bar_after(end_bar_idx)
        if k is not None:
            candidate_bars.append(_snap_to_phrase(k))
    for bu in buildups:
        end_bar_idx = int(np.searchsorted(downbeats, bu["end"], side="left"))
        k = first_loud_bar_after(end_bar_idx)
        if k is not None:
            candidate_bars.append(_snap_to_phrase(k))

    candidate_bars.sort()
    candidates = [float(downbeats[b]) for b in candidate_bars]
    dedupe_sec = DROP_DEDUPE_BARS * mean_bar_sec
    for t in candidates:
        if not drops_sec or (t - drops_sec[-1]) > dedupe_sec:
            drops_sec.append(t)

    max_drops = max(1, int(duration // 30))
    if len(drops_sec) > max_drops:
        drops_sec = drops_sec[:max_drops]

    drops_sec = [round(t, 3) for t in drops_sec]

# === Signal B: Foote novelty over per-bar MFCC self-similarity ==============
# Computed unconditionally so analysis_meta always reports a value, even if
# the percentile pass said "no structure". Novelty breakdowns are still
# gated by struct_p50 so a structureless track will typically add nothing.
print("Computing MFCCs (13 coeff)...", flush=True)
mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, n_fft=n_fft, hop_length=hop)
# Per-bar median MFCC vector, shape (num_bars, 13).
mfcc_per_bar = aggregate_mfcc_per_bar(mfcc, frame_times, downbeats, duration)
print("Computing MFCC self-similarity matrix...", flush=True)
ssm = cosine_ssm(mfcc_per_bar)
kernel_n = max(2, min(NOVELTY_KERNEL_BARS, max(2, num_bars // 4)))
# find_peaks needs at least kernel_n bars on each side for a meaningful score.
print(f"Sliding Foote checkerboard kernel (2N={2*kernel_n} bars)...", flush=True)
kernel = foote_checkerboard_kernel(kernel_n)
novelty_curve = foote_novelty(ssm, kernel)
peak_idx, _peak_props = find_peaks(
    novelty_curve,
    distance=max(1, NOVELTY_MIN_DISTANCE_BARS),
    prominence=NOVELTY_PROMINENCE,
)
# Drop peaks that fall in the boundary region where the kernel is half-padded
# with zeros — their novelty values are dominated by padding, not content.
novelty_peaks_bars = [int(i) for i in peak_idx if kernel_n <= i < num_bars - kernel_n]
novelty_peaks_bars.sort()
print(f"Novelty peaks (inside valid region): {len(novelty_peaks_bars)}", flush=True)

# Merge percentile breakdowns with novelty peaks.
#   "confirmed-by-both":  novelty peak is within +/-tol bars of a percentile
#                         breakdown range [start_bar, end_bar_exclusive).
#   "novelty-new":        peak is not near any percentile breakdown AND the
#                         surrounding window is at/below struct_p50.
novelty_confirmed_bars: list[int] = []
novelty_new_breakdowns: list[dict] = []
novelty_new_bar_ranges: list[tuple[int, int]] = []

def _near_any_percentile_breakdown(bar: int) -> bool:
    for (s, e) in percentile_breakdown_bars:
        # Interpret "within +/-tol bars" as distance from the range [s, e).
        if bar >= s - NOVELTY_CONFIRM_TOLERANCE_BARS and \
                bar < e + NOVELTY_CONFIRM_TOLERANCE_BARS:
            return True
    return False


def _window_below_p50(bar: int) -> bool:
    lo = max(0, bar + NOVELTY_ENERGY_WINDOW[0])
    hi = min(num_bars, bar + NOVELTY_ENERGY_WINDOW[1])
    if hi <= lo:
        return False
    return float(np.mean(struct_per_bar[lo:hi])) <= struct_p50


def _extend_novelty_end(bar: int) -> int:
    """Walk forward from a novelty peak until energy returns (> struct_p50)
    OR we hit the max-length cap. Produces variable-width breakdowns
    that end when the section actually does, not at a fixed 4 bars."""
    k = bar
    cap = min(num_bars, bar + NOVELTY_NEW_BREAKDOWN_BARS_MAX)
    while k < cap and struct_per_bar[k] <= struct_p50:
        k += 1
    # Require at least 2 bars of low energy, otherwise this is a transient,
    # not a section boundary.
    if k - bar < 2:
        return -1
    return k


for bar in novelty_peaks_bars:
    if _near_any_percentile_breakdown(bar):
        novelty_confirmed_bars.append(bar)
        continue
    if not _window_below_p50(bar):
        continue  # loud transition — that's a drop, not a breakdown
    end_bar = _extend_novelty_end(bar)
    if end_bar < 0:
        continue  # too short to be a real section
    start_t = float(downbeats[bar])
    end_t = _snap_end_to_grid(end_bar - 1) if end_bar > 0 else float(downbeats[bar]) + mean_bar_sec
    novelty_new_breakdowns.append({"start": round(start_t, 3), "end": round(end_t, 3)})
    novelty_new_bar_ranges.append((bar, end_bar))

# Combine percentile + novelty-new breakdowns, sort, merge overlaps.
all_ranges: list[tuple[float, float, str]] = []
for bd in percentile_breakdowns:
    all_ranges.append((bd["start"], bd["end"], "percentile"))
for bd in novelty_new_breakdowns:
    all_ranges.append((bd["start"], bd["end"], "novelty-new"))
all_ranges.sort(key=lambda r: (r[0], r[1]))

merged_breakdowns: list[dict] = []
merged_sources: list[str] = []
for s, e, src in all_ranges:
    if merged_breakdowns and s <= merged_breakdowns[-1]["end"]:
        merged_breakdowns[-1]["end"] = round(max(merged_breakdowns[-1]["end"], e), 3)
        # Source precedence: percentile+novelty-new overlap → percentile wins
        # (the percentile range was already the "hard" signal).
        if merged_sources[-1] == "novelty-new" and src == "percentile":
            merged_sources[-1] = "percentile"
    else:
        merged_breakdowns.append({"start": round(s, 3), "end": round(e, 3)})
        merged_sources.append(src)

# Apply "confirmed-by-both" upgrade: any merged breakdown that overlaps a
# novelty-confirmed bar gets its source flagged accordingly.
for i, bd in enumerate(merged_breakdowns):
    bd_start_bar = int(np.searchsorted(downbeats, bd["start"], side="left"))
    bd_end_bar = int(np.searchsorted(downbeats, bd["end"], side="left"))
    for cb in novelty_confirmed_bars:
        if bd_start_bar - NOVELTY_CONFIRM_TOLERANCE_BARS <= cb < bd_end_bar + NOVELTY_CONFIRM_TOLERANCE_BARS:
            merged_sources[i] = "confirmed-by-both"
            break

breakdowns = merged_breakdowns
breakdown_sources = merged_sources

# A buildup that sits inside (or mostly inside) a breakdown is nonsensical
# — the detector would be saying the track is simultaneously stripping
# down AND ramping up. This happens on gradual EDM intros where the full
# first ~30s is both quiet (qualifies as breakdown) and monotonically
# rising (qualifies as buildup). A real buildup is a distinct riser,
# 8–16 bars, right before a drop. Discard buildups whose overlap with any
# breakdown exceeds 50% of their own duration.
def _overlap_fraction(bu: dict, breakdowns_list: list[dict]) -> float:
    bu_len = bu["end"] - bu["start"]
    if bu_len <= 0:
        return 0.0
    overlap = 0.0
    for bd in breakdowns_list:
        lo = max(bu["start"], bd["start"])
        hi = min(bu["end"], bd["end"])
        if hi > lo:
            overlap += hi - lo
    return overlap / bu_len


buildups = [b for b in buildups if _overlap_fraction(b, breakdowns) < 0.5]

bar_rank = percentile_rank(struct_per_bar) if num_bars else np.array([])
energy = [
    {"t": round(float(downbeats[i]), 3), "rel": round(float(bar_rank[i]), 4)}
    for i in range(num_bars)
]

for legacy_key in ("silences", "drop_detection"):
    data.pop(legacy_key, None)

data["drops"] = drops_sec
data["breakdowns"] = breakdowns
data["buildups"] = buildups
data["energy"] = energy
data["analysis_meta"] = {
    "algorithm": "adaptive-percentile-v2+foote-novelty",
    "boundaries_source": "percentile+novelty",
    "primary_signal": "highs+air (2k–16kHz)",
    "bass_band_hz": list(BASS_BAND_HZ),
    "highs_band_hz": list(HIGHS_BAND_HZ),
    "air_band_hz": list(AIR_BAND_HZ),
    "bars_per_breakdown_min": BARS_PER_BREAKDOWN_MIN,
    "bars_per_buildup_min": BARS_PER_BUILDUP_MIN,
    "drop_quantize": "downbeat",
    "structure_delta_db_min": STRUCTURE_DELTA_DB_MIN,
    "structure_detected": bool(structure_detected),
    "computed_percentiles": {
        "struct_p25": round(struct_p25, 3),
        "struct_p50": round(struct_p50, 3),
        "struct_p70": round(struct_p70, 3),
        "bass_p25": round(bass_p25, 3),
        "bass_p50": round(bass_p50, 3),
        "bass_p70": round(bass_p70, 3),
        "delta_db": round(structure_delta, 3),
    },
    "energy_shape": "[{t: downbeat_sec, rel: struct_percentile_rank_0_1}]",
    "novelty_peaks_bars": list(novelty_peaks_bars),
    "novelty_peaks_count": int(len(novelty_peaks_bars)),
    "novelty_kernel_bars": int(kernel_n),
    "novelty_min_distance_bars": int(NOVELTY_MIN_DISTANCE_BARS),
    "novelty_confirm_tolerance_bars": int(NOVELTY_CONFIRM_TOLERANCE_BARS),
    "novelty_confirmed_bars": list(novelty_confirmed_bars),
    "novelty_new_breakdowns_count": int(len(novelty_new_breakdowns)),
    "percentile_breakdowns_count": int(len(percentile_breakdowns)),
    "breakdown_sources": list(breakdown_sources),
}

# Atomic write so a mid-run kill can't corrupt the JSON.
tmp_path = BEATS_JSON + ".tmp"
with open(tmp_path, "w") as f:
    json.dump(data, f)
os.replace(tmp_path, BEATS_JSON)

print()
print(f"Updated {BEATS_JSON}")
print()
print("=== SUMMARY ===")
print(f"  bass_p25:     {bass_p25:.2f} dB")
print(f"  bass_p70:     {bass_p70:.2f} dB")
print(f"  struct_p25:   {struct_p25:.2f} dB  (highs+air, primary detector signal)")
print(f"  struct_p70:   {struct_p70:.2f} dB")
print(f"  num bars:     {num_bars}")
print(f"  drops:        {len(drops_sec)}")
print(f"  breakdowns:   {len(breakdowns)}  (percentile={len(percentile_breakdowns)}, "
      f"novelty-new={len(novelty_new_breakdowns)})")
print(f"  buildups:     {len(buildups)}")
print(f"  novelty peaks:     {len(novelty_peaks_bars)}  (kernel 2N={2*kernel_n} bars)")
print(f"  novelty confirmed: {len(novelty_confirmed_bars)}  (within +/-{NOVELTY_CONFIRM_TOLERANCE_BARS} bars)")
if not structure_detected:
    print("  WARNING: p70 - p25 < 6 dB — track has no meaningful structure.")

if drops_sec:
    print()
    print("DROPS TIMELINE:")
    for d in drops_sec:
        m = int(d // 60)
        s = d - m * 60
        print(f"  {m:>3d}:{s:05.2f}")

if breakdowns:
    print()
    print(f"BREAKDOWNS ({len(breakdowns)}) [source]:")
    for bd, src in zip(breakdowns, breakdown_sources):
        sm, ss = int(bd["start"] // 60), bd["start"] % 60
        em, es = int(bd["end"] // 60), bd["end"] % 60
        dur = bd["end"] - bd["start"]
        print(f"  {sm:>3d}:{ss:05.2f} -> {em:>3d}:{es:05.2f}   "
              f"({dur:5.1f}s)  [{src}]")

if novelty_peaks_bars:
    print()
    print(f"NOVELTY PEAKS ({len(novelty_peaks_bars)}):")
    for bar in novelty_peaks_bars:
        t = float(downbeats[bar])
        m, s = int(t // 60), t % 60
        tag = "confirmed" if bar in novelty_confirmed_bars else "unconfirmed"
        print(f"  bar {bar:>4d}  @ {m:>3d}:{s:05.2f}   [{tag}]")

if buildups:
    print()
    print(f"BUILDUPS ({len(buildups)}):")
    for bu in buildups:
        sm, ss = int(bu["start"] // 60), bu["start"] % 60
        em, es = int(bu["end"] // 60), bu["end"] % 60
        dur = bu["end"] - bu["start"]
        print(f"  {sm:>3d}:{ss:05.2f} -> {em:>3d}:{es:05.2f}   ({dur:.1f}s)")
