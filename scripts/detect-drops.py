"""Track-agnostic EDM structure detector (adaptive-percentile-v2).

Replaces the legacy absolute-dB detector. All thresholds are derived from
per-track percentiles of banded RMS aggregated per-bar using the beat grid
produced by detect-beats.py — so the detector self-calibrates to any mix.

The primary "is this a breakdown" signal is HIGHS+AIR energy, not bass.
Deep house / minimal techno often keep bass playing through breakdowns
while stripping out hats, pads, and leads — a bass-only detector flags
such tracks as structureless (v1 did this). Highs/air dropping is the
common signature across EDM subgenres.

Algorithm summary:
  1. Banded RMS: bass (80-250 Hz), highs (2k-8k), air (8k+).
  2. Per-bar aggregation (median) between consecutive downbeats.
  3. Primary curve: struct_per_bar = dB(highs + air) per bar.
  4. Percentiles on struct: struct_p25 ("stripped down") and struct_p70 ("full").
  5. Guardrail: if struct_p70 - struct_p25 < 6 dB, the track has no
     meaningful structure — emit empty lists and a warning.
  6. Breakdown: >=8 consecutive bars at or below struct_p25.
  7. Buildup: >=4 consecutive bars where struct_per_bar slope is positive
     AND bass is flat / below bass_p50. The classic riser pattern.
  8. Drop: single downbeat timestamp — first bar after a breakdown/buildup
     where BOTH struct_per_bar >= struct_p70 AND bass_per_bar >= bass_p50
     (the full mix comes back, not just hats). Dedupe within 1 bar, cap
     at floor(dur/30).
  9. Energy: struct_per_bar stored as percentile rank in [0, 1] per bar.

Augments the input beats JSON in place. Existing `drops`, `breakdowns`,
`energy` keys are retained (types preserved). Legacy `silences` and
`drop_detection` keys are removed.
"""
import argparse
import json
import os

import librosa
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument("--audio", required=True)
parser.add_argument("--beats-json", required=True,
                    help="Path to beats JSON (will be augmented in place)")
args = parser.parse_args()
AUDIO = args.audio
BEATS_JSON = args.beats_json

BASS_BAND_HZ = (80.0, 250.0)
HIGHS_BAND_HZ = (2000.0, 8000.0)
AIR_BAND_HZ = (8000.0, 16000.0)

BARS_PER_BREAKDOWN_MIN = 8
BARS_PER_BUILDUP_MIN = 4
STRUCTURE_DELTA_DB_MIN = 6.0
DROP_DEDUPE_BARS = 1


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
struct_p25 = float(np.percentile(struct_per_bar, 25))
struct_p50 = float(np.percentile(struct_per_bar, 50))
struct_p70 = float(np.percentile(struct_per_bar, 70))
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
buildups: list[dict] = []
drops_sec: list[float] = []

if structure_detected:
    breakdown_mask = struct_per_bar <= struct_p25
    for start_bar, end_bar in runs_where(breakdown_mask, BARS_PER_BREAKDOWN_MIN):
        start_t = float(downbeats[start_bar])
        end_bar_start = float(downbeats[end_bar])
        # Breakdown ends at the downbeat after the last qualifying bar.
        end_t = float(downbeats[end_bar + 1]) if end_bar + 1 < len(downbeats) \
            else end_bar_start + mean_bar_sec
        breakdowns.append({"start": round(start_t, 3), "end": round(end_t, 3)})

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
        end_bar_start = float(downbeats[end_bar])
        end_t = float(downbeats[end_bar + 1]) if end_bar + 1 < len(downbeats) \
            else end_bar_start + mean_bar_sec
        buildups.append({"start": round(start_t, 3), "end": round(end_t, 3)})

    def first_loud_bar_after(bar_idx: int) -> int | None:
        # Drop = full mix returns: hats/air up AND bass present.
        for k in range(bar_idx, num_bars):
            if struct_per_bar[k] >= struct_p70 and bass_per_bar[k] >= bass_p50:
                return k
        return None

    candidates: list[float] = []
    for bd in breakdowns:
        end_bar_idx = int(np.searchsorted(downbeats, bd["end"], side="left"))
        k = first_loud_bar_after(end_bar_idx)
        if k is not None:
            candidates.append(float(downbeats[k]))
    for bu in buildups:
        end_bar_idx = int(np.searchsorted(downbeats, bu["end"], side="left"))
        k = first_loud_bar_after(end_bar_idx)
        if k is not None:
            candidates.append(float(downbeats[k]))

    candidates.sort()
    dedupe_sec = DROP_DEDUPE_BARS * mean_bar_sec
    for t in candidates:
        if not drops_sec or (t - drops_sec[-1]) > dedupe_sec:
            drops_sec.append(t)

    max_drops = max(1, int(duration // 30))
    if len(drops_sec) > max_drops:
        drops_sec = drops_sec[:max_drops]

    drops_sec = [round(t, 3) for t in drops_sec]

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
    "algorithm": "adaptive-percentile-v2",
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
print(f"  bass_p25:   {bass_p25:.2f} dB")
print(f"  bass_p70:   {bass_p70:.2f} dB")
print(f"  struct_p25: {struct_p25:.2f} dB  (highs+air, primary detector signal)")
print(f"  struct_p70: {struct_p70:.2f} dB")
print(f"  num bars:   {num_bars}")
print(f"  drops:      {len(drops_sec)}")
print(f"  breakdowns: {len(breakdowns)}")
print(f"  buildups:   {len(buildups)}")
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
    print(f"BREAKDOWNS ({len(breakdowns)}):")
    for bd in breakdowns:
        sm, ss = int(bd["start"] // 60), bd["start"] % 60
        em, es = int(bd["end"] // 60), bd["end"] % 60
        dur = bd["end"] - bd["start"]
        print(f"  {sm:>3d}:{ss:05.2f} -> {em:>3d}:{es:05.2f}   ({dur:.1f}s)")

if buildups:
    print()
    print(f"BUILDUPS ({len(buildups)}):")
    for bu in buildups:
        sm, ss = int(bu["start"] // 60), bu["start"] % 60
        em, es = int(bu["end"] // 60), bu["end"] % 60
        dur = bu["end"] - bu["start"]
        print(f"  {sm:>3d}:{ss:05.2f} -> {em:>3d}:{es:05.2f}   ({dur:.1f}s)")
