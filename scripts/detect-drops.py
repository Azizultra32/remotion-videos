"""Detect breakdowns and drops across the entire mix.

Strategy:
- Compute low-frequency (bass) RMS in ~1s windows.
- Compute full-spectrum RMS too, for reference.
- A "breakdown" = region where bass RMS falls below X% of rolling max for >= 4s.
- A "drop" = first moment after a breakdown where bass RMS crosses back above
  a high threshold (indicating the kick/bass returning).
- Also flag sudden-jump drops where bass RMS rises sharply from a medium level
  to its rolling max (non-breakdown drops / energy builds).

Augments public/dubfire-beats.json with:
  "breakdowns": [{start, end}, ...]
  "drops":      [seconds, ...]
  "energy":     [{t, bass_db}, ...]   # sampled every 1s for plotting
"""
import argparse
import json
import os
import numpy as np
import librosa
from scipy.signal import medfilt
from scipy.ndimage import maximum_filter1d

parser = argparse.ArgumentParser()
parser.add_argument("--audio", default="out/dubfire-sake.wav")
parser.add_argument("--beats-json", default="public/dubfire-beats.json",
                    help="Path to beats JSON (will be augmented in place)")
args = parser.parse_args()
AUDIO = args.audio
BEATS_JSON = args.beats_json

print("Loading audio...", flush=True)
y, sr = librosa.load(AUDIO, sr=22050, mono=True)
duration = librosa.get_duration(y=y, sr=sr)
print(f"Duration: {duration:.1f}s ({duration / 60:.1f} min)", flush=True)

# STFT with generous window for low-freq resolution
n_fft = 4096
hop = 1024  # ~46 ms at 22050
print("Computing STFT...", flush=True)
S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop))
freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

# Bass band: 40-180 Hz (kick + sub)
bass_mask = (freqs >= 40) & (freqs <= 180)
print(f"Bass band: {bass_mask.sum()} bins", flush=True)

bass_rms = np.sqrt(np.mean(S[bass_mask, :] ** 2, axis=0))
times = librosa.frames_to_time(np.arange(bass_rms.shape[0]), sr=sr, hop_length=hop)

# Smooth with median filter (~1.5s) to ignore transient gaps
kernel = int((1.5 * sr) / hop)
if kernel % 2 == 0:
    kernel += 1
bass_smooth = medfilt(bass_rms, kernel_size=kernel)

# High-freq (2kHz-8kHz) for transient detection (hi-hats, snares, claps)
hf_mask = (freqs >= 2000) & (freqs <= 8000)
print(f"High-freq band: {hf_mask.sum()} bins", flush=True)
hf_rms = np.sqrt(np.mean(S[hf_mask, :] ** 2, axis=0))
hf_smooth = medfilt(hf_rms, kernel_size=kernel)
hf_max = np.max(hf_smooth) + 1e-12
hf_db = 20 * np.log10(hf_smooth / hf_max + 1e-12)

# dB scale relative to max
max_rms = np.max(bass_smooth) + 1e-12
bass_db = 20 * np.log10(bass_smooth / max_rms + 1e-12)

# Thresholds
LOW_DB = -14.0   # below this = bass gone / breakdown
HIGH_DB = -4.0   # above this = full bass back
MIN_BREAKDOWN_SEC = 4.0
MIN_GAP_BETWEEN_DROPS_SEC = 10.0

# Find contiguous regions below LOW_DB
below = bass_db < LOW_DB
breakdowns = []
i = 0
N = len(below)
while i < N:
    if below[i]:
        j = i
        while j < N and below[j]:
            j += 1
        start_t = float(times[i])
        end_t = float(times[j - 1]) if j - 1 < len(times) else float(times[-1])
        if end_t - start_t >= MIN_BREAKDOWN_SEC:
            breakdowns.append({"start": round(start_t, 3), "end": round(end_t, 3)})
        i = j
    else:
        i += 1

print(f"Breakdowns found: {len(breakdowns)}", flush=True)

# Find complete silence regions (both bass AND hi-freq gone)
SILENCE_BASS_DB = -18.0
SILENCE_HF_DB = -20.0
MIN_SILENCE_SEC = 1.5

silence_mask = (bass_db < SILENCE_BASS_DB) & (hf_db < SILENCE_HF_DB)
silences = []
i = 0
while i < N:
    if silence_mask[i]:
        j = i
        while j < N and silence_mask[j]:
            j += 1
        start_t = float(times[i])
        end_t = float(times[j - 1]) if j - 1 < len(times) else float(times[-1])
        if end_t - start_t >= MIN_SILENCE_SEC:
            silences.append({"start": round(start_t, 3), "end": round(end_t, 3)})
        i = j
    else:
        i += 1

print(f"Silence regions found: {len(silences)}", flush=True)

# Drops = first time after a breakdown end where bass_db crosses >= HIGH_DB
# AND no drop has been recorded in the last MIN_GAP seconds.
drops = []
last_drop_t = -np.inf
for bd in breakdowns:
    # search forward from breakdown end
    end_idx = np.searchsorted(times, bd["end"])
    for k in range(end_idx, N):
        if bass_db[k] >= HIGH_DB:
            t = float(times[k])
            if t - last_drop_t >= MIN_GAP_BETWEEN_DROPS_SEC:
                drops.append(round(t, 3))
                last_drop_t = t
            break

# Also add standalone rising-edge drops (outside breakdowns): sharp rises.
# Detect frames where bass_db goes from < -8 to >= -3 within 2s.
for k in range(N):
    if bass_db[k] >= -3.0:
        # look back 2s
        look = int(2 * sr / hop)
        prev = max(0, k - look)
        if bass_db[prev:k].min() < -8.0:
            t = float(times[k])
            if t - last_drop_t >= MIN_GAP_BETWEEN_DROPS_SEC:
                drops.append(round(t, 3))
                last_drop_t = t

# Re-entry drops = first moment after silence where BOTH bass and hf return strongly
REENTRY_BASS_DB = -5.0
REENTRY_HF_DB = -8.0

reentry_drops = []
for silence in silences:
    end_idx = np.searchsorted(times, silence["end"])
    # Look forward up to 3 seconds
    search_range = min(end_idx + int(3 * sr / hop), N)
    for k in range(end_idx, search_range):
        if bass_db[k] >= REENTRY_BASS_DB and hf_db[k] >= REENTRY_HF_DB:
            t = float(times[k])
            if t - last_drop_t >= MIN_GAP_BETWEEN_DROPS_SEC:
                reentry_drops.append(round(t, 3))
                last_drop_t = t
            break

print(f"Re-entry drops found: {len(reentry_drops)}", flush=True)

# Merge breakdown drops, standalone drops, and re-entry drops
all_drops = drops + reentry_drops
all_drops = list(set(all_drops))  # Remove duplicates
all_drops.sort()

print(f"Total drops found: {len(all_drops)}", flush=True)
print("First 10 drops:", [f"{d/60:.0f}:{d%60:04.1f}" for d in all_drops[:10]], flush=True)

# Sampled energy curve every 1s
sample_step_sec = 1.0
step_frames = int(sample_step_sec * sr / hop)
energy = []
for k in range(0, N, step_frames):
    energy.append({"t": round(float(times[k]), 2), "db": round(float(bass_db[k]), 2)})

# Merge into beats JSON
with open(BEATS_JSON) as f:
    data = json.load(f)
data["breakdowns"] = breakdowns
data["silences"] = silences
data["drops"] = all_drops
data["energy"] = energy
data["drop_detection"] = {
    "low_db": LOW_DB,
    "high_db": HIGH_DB,
    "silence_bass_db": SILENCE_BASS_DB,
    "silence_hf_db": SILENCE_HF_DB,
    "reentry_bass_db": REENTRY_BASS_DB,
    "reentry_hf_db": REENTRY_HF_DB,
    "min_breakdown_sec": MIN_BREAKDOWN_SEC,
    "min_silence_sec": MIN_SILENCE_SEC,
    "min_gap_sec": MIN_GAP_BETWEEN_DROPS_SEC,
}
# Atomic write: write to temp file, then os.replace to avoid corrupting
# the existing beats JSON if this script is killed mid-write.
tmp_path = BEATS_JSON + ".tmp"
with open(tmp_path, "w") as f:
    json.dump(data, f)
os.replace(tmp_path, BEATS_JSON)

print(f"Updated {BEATS_JSON}", flush=True)
print()
print("DROPS TIMELINE:")
for d in all_drops:
    m = int(d // 60)
    s = d - m * 60
    print(f"  {m:>3d}:{s:05.2f}")
print()
print(f"BREAKDOWNS ({len(breakdowns)}):")
for bd in breakdowns[:20]:
    sm, ss = int(bd["start"] // 60), bd["start"] % 60
    em, es = int(bd["end"] // 60), bd["end"] % 60
    dur = bd["end"] - bd["start"]
    print(f"  {sm:>3d}:{ss:05.2f} -> {em:>3d}:{es:05.2f}   ({dur:.1f}s)")
if len(breakdowns) > 20:
    print(f"  ... and {len(breakdowns) - 20} more")
print()
print(f"SILENCES ({len(silences)}):")
for sil in silences[:20]:
    sm, ss = int(sil["start"] // 60), sil["start"] % 60
    em, es = int(sil["end"] // 60), sil["end"] % 60
    dur = sil["end"] - sil["start"]
    print(f"  {sm:>3d}:{ss:05.2f} -> {em:>3d}:{es:05.2f}   ({dur:.1f}s)")
if len(silences) > 20:
    print(f"  ... and {len(silences) - 20} more")
