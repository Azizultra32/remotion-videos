"""Detect ALL onsets (every sound event) and export as timestamps.

Also export a per-frame "flash" value: for each video frame,
flash = exp(-decay * timeSinceLastOnset). Creates sharp flicker
that dies fast between events.
"""
import json
import numpy as np
import librosa

AUDIO = "out/dubfire-sake.wav"
VIDEO_FPS = 24
DECAY = 2.5  # Slow — each flash lingers ~1.5 seconds before dying.
OUT = "public/dubfire-energy-24fps.json"

print("Loading audio...", flush=True)
y, sr = librosa.load(AUDIO, sr=22050, mono=True)
duration = librosa.get_duration(y=y, sr=sr)
total_frames = int(duration * VIDEO_FPS)
print(f"{duration:.1f}s → {total_frames} video frames", flush=True)

# Detect ALL onsets at high resolution.
print("Computing onset envelope...", flush=True)
hop = 256  # ~11.6ms — very fine resolution
onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)

print("Detecting onsets...", flush=True)
onset_frames = librosa.onset.onset_detect(
    onset_envelope=onset_env, sr=sr, hop_length=hop,
    backtrack=False, units='frames'
)
onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop)
print(f"Onsets detected: {len(onset_times)}", flush=True)
print(f"First 20: {[round(t, 3) for t in onset_times[:20]]}", flush=True)

# Also get onset strength at each onset for intensity weighting.
onset_strengths = onset_env[onset_frames]
max_strength = onset_strengths.max() + 1e-12

print("Computing per-frame flash values...", flush=True)
flash = np.zeros(total_frames, dtype=np.float32)

# For each frame, find time since last onset and compute flash.
onset_idx = 0
n_onsets = len(onset_times)

for vf in range(total_frames):
    t = vf / VIDEO_FPS
    # Advance onset pointer.
    while onset_idx < n_onsets - 1 and onset_times[onset_idx + 1] <= t:
        onset_idx += 1

    if onset_idx < n_onsets and onset_times[onset_idx] <= t:
        dt = t - onset_times[onset_idx]
        # Every onset = full brightness flash. No strength weighting.
        flash[vf] = np.exp(-DECAY * dt)
    else:
        flash[vf] = 0.0

print(f"Flash range: {flash.min():.4f} – {flash.max():.4f}", flush=True)
print(f"Non-zero frames: {(flash > 0.01).sum()} / {total_frames}", flush=True)

out_list = [round(float(v), 3) for v in flash]
with open(OUT, 'w') as f:
    json.dump(out_list, f)

import os
print(f"Wrote {OUT}: {os.path.getsize(OUT)/1024/1024:.1f} MB", flush=True)
