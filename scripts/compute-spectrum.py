"""Compute per-frame frequency spectrum (8 bands) for visualization.

Output: public/dubfire-spectrum-24fps.json
Array of arrays: spectrum[frame] = [band0, band1, ..., band7]
Each value 0..1 (locally normalized per band).
"""
import argparse
import json
import numpy as np
import librosa
from scipy.ndimage import maximum_filter1d

parser = argparse.ArgumentParser()
parser.add_argument("--audio", default="out/dubfire-sake.wav")
parser.add_argument("--fps", type=int, default=24)
parser.add_argument("--bands", type=int, default=16)
parser.add_argument("--out", default="public/dubfire-spectrum-24fps.json")
args = parser.parse_args()
AUDIO = args.audio
VIDEO_FPS = args.fps
N_BANDS = args.bands
LOCAL_WINDOW_SEC = 3.0
OUT = args.out

print("Loading audio...", flush=True)
y, sr = librosa.load(AUDIO, sr=22050, mono=True)
duration = librosa.get_duration(y=y, sr=sr)
total_frames = int(duration * VIDEO_FPS)
print(f"{duration:.1f}s → {total_frames} frames", flush=True)

# STFT at video frame rate.
hop = int(sr / VIDEO_FPS)
n_fft = 2048

print("Computing STFT...", flush=True)
S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop))
freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

# Define frequency bands (logarithmic spacing for musical relevance).
band_edges = np.logspace(np.log10(30), np.log10(10000), N_BANDS + 1)
print(f"Band edges: {[int(b) for b in band_edges]} Hz", flush=True)

print("Computing band energies...", flush=True)
n_stft_frames = S.shape[1]
bands = np.zeros((n_stft_frames, N_BANDS), dtype=np.float32)

for b in range(N_BANDS):
    lo = band_edges[b]
    hi = band_edges[b + 1]
    mask = (freqs >= lo) & (freqs < hi)
    if mask.sum() > 0:
        bands[:, b] = np.sqrt(np.mean(S[mask, :] ** 2, axis=0))

# Local normalization per band.
print("Local normalization per band...", flush=True)
win = int(LOCAL_WINDOW_SEC * VIDEO_FPS)
for b in range(N_BANDS):
    local_max = maximum_filter1d(bands[:, b], size=win * 2, mode='reflect')
    local_max = np.maximum(local_max, 1e-10)
    bands[:, b] = bands[:, b] / local_max

# Trim to total_frames.
if bands.shape[0] > total_frames:
    bands = bands[:total_frames]
elif bands.shape[0] < total_frames:
    pad = np.zeros((total_frames - bands.shape[0], N_BANDS))
    bands = np.vstack([bands, pad])

print("Writing...", flush=True)
out = [[round(float(bands[f, b]), 2) for b in range(N_BANDS)] for f in range(total_frames)]
with open(OUT, 'w') as f:
    json.dump(out, f)

import os
print(f"Wrote {OUT}: {os.path.getsize(OUT)/1024/1024:.1f} MB", flush=True)
