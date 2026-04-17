"""Detect beats and downbeats in an audio file using librosa.

Usage: python3 scripts/detect-beats.py [--audio PATH] [--out PATH]

Defaults match the dubfire mix for backward compatibility. Output JSON:
{
  "duration": seconds,
  "bpm_global": float,
  "beats": [seconds, ...],
  "downbeats": [seconds, ...],   # every 4th beat starting from detected phase
  "tempo_curve": [{t, bpm}, ...] # local BPM sampled every 10s
  "drops": [],        # populated later by detect-drops.py
  "breakdowns": [],   # populated later by detect-drops.py
  "energy": []        # populated later by hires-energy.py
}
"""
import argparse
import json
import numpy as np
import librosa

parser = argparse.ArgumentParser()
parser.add_argument("--audio", default="out/dubfire-sake.wav")
parser.add_argument("--out", default="public/dubfire-beats.json")
args = parser.parse_args()
AUDIO = args.audio
OUT = args.out

print("Loading audio...", flush=True)
y, sr = librosa.load(AUDIO, sr=22050, mono=True)
duration = librosa.get_duration(y=y, sr=sr)
print(f"Duration: {duration:.1f}s", flush=True)

print("Computing onset envelope...", flush=True)
onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=512)

print("Tracking beats (this takes a while)...", flush=True)
tempo, beat_frames = librosa.beat.beat_track(
    onset_envelope=onset_env, sr=sr, hop_length=512, units="frames"
)
beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=512)
print(f"Global BPM estimate: {float(tempo):.2f}  |  beats: {len(beat_times)}", flush=True)

print("Computing tempogram for local BPM curve...", flush=True)
tempogram = librosa.feature.tempogram(onset_envelope=onset_env, sr=sr, hop_length=512)
tempo_dyn = librosa.feature.tempo(
    onset_envelope=onset_env, sr=sr, hop_length=512, aggregate=None
)
times = librosa.times_like(tempo_dyn, sr=sr, hop_length=512)
sample_every = 10.0
tempo_curve = []
last_t = -sample_every
for t, b in zip(times, tempo_dyn):
    if t - last_t >= sample_every:
        tempo_curve.append({"t": round(float(t), 3), "bpm": round(float(b), 2)})
        last_t = t

downbeats = [float(t) for t in beat_times[::4]]

out = {
    "duration": round(float(duration), 3),
    "bpm_global": round(float(tempo), 3),
    "beats": [round(float(t), 4) for t in beat_times],
    "downbeats": [round(t, 4) for t in downbeats],
    "tempo_curve": tempo_curve,
    # Empty placeholders so the BeatData type is satisfied without having to
    # run detect-drops.py and hires-energy.py. Those scripts augment this file.
    "drops": [],
    "breakdowns": [],
    "energy": [],
}

with open(OUT, "w") as f:
    json.dump(out, f)

print(f"Wrote {OUT}: {len(beat_times)} beats, {len(downbeats)} downbeats, {len(tempo_curve)} tempo samples", flush=True)
