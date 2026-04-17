"""Detect beats and downbeats in an audio file.

Usage: python3 scripts/detect-beats.py [--audio PATH] [--out PATH]
                                       [--use-madmom] [--librosa-beats]
                                       [--extend-intro]

Two downbeat backends:

  librosa (default): librosa.beat.beat_track + `downbeats = beats[::4]`.
    Fast (<5s CPU realtime) but has no phase awareness — if the first
    detected beat is on beat-2 of the bar, every 4th beat will be off
    by one and the "downbeat" array is misaligned. This has been the
    source of visible drift in the editor on multiple tracks.

  madmom (--use-madmom, recommended): madmom's DBNDownBeatTrackingProcessor
    RNN-then-HMM model that EXPLICITLY tracks bar phase. Slower
    (~10-20× realtime on CPU) but produces authoritative downbeats.
    We still use librosa for the full beat grid (much denser beat
    output, madmom only reports beats-within-bars), but the downbeats
    come from madmom.

When --use-madmom is on, prints a comparison: first 20 downbeats from
librosa-[::4] vs first 20 from madmom, and the mean absolute phase
error in beats — tells you whether librosa's phase was right all along.

Output JSON:
  {
    "duration": seconds,
    "bpm_global": float,
    "beats": [seconds, ...],           # librosa (dense beat grid)
    "downbeats": [seconds, ...],       # from madmom if --use-madmom, else beats[::4]
    "tempo_curve": [{t, bpm}, ...],    # local BPM sampled every 10s
    "downbeat_backend": "madmom" | "librosa[::4]",
    "drops": [], "breakdowns": [], "energy": []   # later-stage fields
  }
"""
import argparse
import json
import sys

import numpy as np
import librosa

from track_config import load_config

parser = argparse.ArgumentParser()
parser.add_argument("--audio", default="out/dubfire-sake.wav")
parser.add_argument("--out", default="public/dubfire-beats.json")
parser.add_argument(
    "--extend-intro",
    action="store_true",
    help="Extrapolate beats backwards from the first detected beat at the "
    "locked BPM so the grid covers the intro. Detectors often won't commit "
    "to a tempo when only a bass line is present (no kick/snare) — this "
    "fills in the missing grid.",
)
backend = parser.add_mutually_exclusive_group()
backend.add_argument(
    "--use-madmom",
    action="store_true",
    help="Use madmom's DBNDownBeatTrackingProcessor (RNN+HMM) for "
    "downbeat phase. Slower but authoritative. Beat grid still comes "
    "from librosa. Default unless --librosa-beats is passed.",
)
backend.add_argument(
    "--librosa-beats",
    action="store_true",
    help="Force librosa-only mode: downbeats = beats[::4]. Fast but no "
    "phase awareness.",
)
parser.add_argument("--config", default=None,
                    help="Optional per-track config JSON; `beats` section "
                    "overrides CLI defaults. See docs/track-config-schema.md.")
args = parser.parse_args()
AUDIO = args.audio
OUT = args.out

cfg = load_config(args.config, "beats")
# Per-track config overrides CLI flags when present.
EXTEND_INTRO = bool(cfg.get("extend_intro", args.extend_intro))
USE_MADMOM = bool(cfg.get("use_madmom", args.use_madmom)) and not args.librosa_beats

print("Loading audio...", flush=True)
y, sr = librosa.load(AUDIO, sr=22050, mono=True)
duration = librosa.get_duration(y=y, sr=sr)
print(f"Duration: {duration:.1f}s", flush=True)

print("Computing onset envelope...", flush=True)
onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=512)

print("Tracking beats (librosa, this takes a while)...", flush=True)
tempo, beat_frames = librosa.beat.beat_track(
    onset_envelope=onset_env, sr=sr, hop_length=512, units="frames"
)
beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=512)
print(f"Global BPM estimate: {float(tempo):.2f}  |  beats: {len(beat_times)}", flush=True)

if EXTEND_INTRO and len(beat_times) > 0:
    first = float(beat_times[0])
    period = 60.0 / float(tempo)
    if first > period:
        padded = []
        t = first - period
        while t > 0:
            padded.append(t)
            t -= period
        padded.reverse()
        beat_times = np.concatenate([np.array(padded), beat_times])
        print(f"  ↳ extended intro with {len(padded)} back-dated beats at "
              f"{60 / period:.2f} BPM (first beat: {beat_times[0]:.2f}s)",
              flush=True)

# Librosa[::4] downbeats — kept even when madmom is on, for comparison.
librosa_downbeats = np.asarray([float(t) for t in beat_times[::4]])

if USE_MADMOM:
    print("Running madmom DBNDownBeatTrackingProcessor...", flush=True)
    try:
        from madmom.features.downbeats import (
            DBNDownBeatTrackingProcessor,
            RNNDownBeatProcessor,
        )
    except Exception as exc:
        print(f"  ✗ madmom import failed: {exc}", file=sys.stderr)
        print("  falling back to librosa[::4] downbeats", file=sys.stderr)
        USE_MADMOM = False

if USE_MADMOM:
    # RNN processor runs a pretrained neural net over the audio — its output
    # is a (frames, 2) array of [beat_prob, downbeat_prob] per 10ms frame.
    rnn = RNNDownBeatProcessor()
    activations = rnn(AUDIO)
    # DBN ties the RNN activations to a bar-phase state machine.
    #
    # Two priors we apply to stop the DBN from half-time-latching a sparse
    # intro (the failure mode that gave the Love-In-Traffic output 15 "bars"
    # at 3.72s spacing before snapping to the correct 1.86s).
    #
    # 1. beats_per_bar=[4]. Deep house / EDM is 4/4. Giving the HMM a 3/4
    #    option lets it settle into a valid-looking-but-wrong interpretation.
    # 2. min_bpm / max_bpm constrained around librosa's global tempo
    #    estimate. With bpm in ±TEMPO_WINDOW_BPM of the estimate and
    #    beats_per_bar=4, a bar of period 2× the true bar is
    #    arithmetically impossible (would imply bpm below min_bpm).
    #    This removes the half-time basin entirely.
    TEMPO_WINDOW_BPM = 15.0
    bpm_est = float(tempo)
    min_bpm = max(60.0, bpm_est - TEMPO_WINDOW_BPM)
    max_bpm = min(210.0, bpm_est + TEMPO_WINDOW_BPM)
    print(f"  tempo prior: {min_bpm:.1f}–{max_bpm:.1f} BPM "
          f"(librosa estimate = {bpm_est:.2f} ± {TEMPO_WINDOW_BPM:.0f}), "
          f"beats_per_bar=[4]", flush=True)
    dbn = DBNDownBeatTrackingProcessor(
        beats_per_bar=[4],
        min_bpm=min_bpm,
        max_bpm=max_bpm,
        fps=100,
    )
    dbn_out = dbn(activations)  # shape (N, 2): [time_sec, beat_pos_within_bar]
    # Downbeats are rows where beat_pos_within_bar == 1.
    madmom_downbeats = dbn_out[dbn_out[:, 1] == 1, 0]
    madmom_downbeats = np.asarray([float(t) for t in madmom_downbeats])
    print(f"  madmom found {len(dbn_out)} beats, "
          f"{len(madmom_downbeats)} downbeats", flush=True)

    # ── Outlier-bisection safety net ───────────────────────────────────
    # Belt-and-suspenders for the tempo prior above. If any remaining
    # delta is still >= 1.5× the median (i.e. madmom skipped a bar
    # despite the prior), insert intermediate downbeats at the expected
    # bar period, snapped to the nearest librosa beat for phase.
    # Track-agnostic: uses the detector's own median delta as ground truth
    # and the librosa beat grid (already in beat_times) for snap targets.
    def _bisect_outlier_deltas(downbeats, beat_grid, max_ratio=1.5):
        """Return a downbeat array with outlier deltas subdivided.

        Any delta >= ``max_ratio × median(deltas)`` is replaced with
        evenly-spaced intermediate downbeats at the median bar period,
        each snapped to the nearest entry in ``beat_grid``. Runs until
        no delta exceeds the threshold or no progress is made.
        """
        if len(downbeats) < 3:
            return downbeats
        beat_grid = np.asarray(beat_grid, dtype=float)
        for _pass in range(8):  # hard cap — protects against infinite loop
            deltas = np.diff(downbeats)
            if len(deltas) == 0:
                break
            median = float(np.median(deltas))
            worst = float(np.max(deltas))
            if median <= 0 or worst < max_ratio * median:
                return downbeats
            out = [downbeats[0]]
            inserted = 0
            for i in range(len(deltas)):
                lo = downbeats[i]
                hi = downbeats[i + 1]
                dt = hi - lo
                # How many bars *should* be in this gap?
                n_bars = int(round(dt / median))
                if n_bars >= 2 and dt >= max_ratio * median:
                    step = dt / n_bars
                    for k in range(1, n_bars):
                        tgt = lo + step * k
                        if len(beat_grid) > 0:
                            snap = float(beat_grid[np.argmin(np.abs(beat_grid - tgt))])
                            # Only snap if it's within half a bar, else keep
                            # the unsnapped interpolation.
                            if abs(snap - tgt) <= 0.5 * median:
                                tgt = snap
                        out.append(tgt)
                        inserted += 1
                out.append(hi)
            new_downbeats = np.asarray(out, dtype=float)
            if inserted == 0 or len(new_downbeats) == len(downbeats):
                return downbeats
            print(f"  bisect pass {_pass + 1}: inserted {inserted} "
                  f"intermediate downbeat(s), new total "
                  f"{len(new_downbeats)}", flush=True)
            downbeats = new_downbeats
        return downbeats

    before = len(madmom_downbeats)
    madmom_downbeats = _bisect_outlier_deltas(
        madmom_downbeats, beat_times, max_ratio=1.5
    )
    if len(madmom_downbeats) != before:
        print(f"  outlier-bisection: {before} → {len(madmom_downbeats)} "
              f"downbeats", flush=True)

    # Phase error comparison against librosa[::4]. For each librosa downbeat,
    # find the nearest madmom downbeat — compute offset in beats (relative to
    # the librosa beat period).
    period = 60.0 / float(tempo) if float(tempo) > 0 else 0.5
    print()
    print("=== DOWNBEAT PHASE COMPARISON (librosa[::4] vs madmom) ===")
    print(f"{'idx':>4} {'librosa':>9} {'madmom':>9} {'Δsec':>7} {'Δbeats':>7}")
    deltas = []
    for i in range(min(20, len(librosa_downbeats))):
        l = float(librosa_downbeats[i])
        if len(madmom_downbeats) == 0:
            break
        m = float(madmom_downbeats[np.argmin(np.abs(madmom_downbeats - l))])
        dsec = m - l
        dbeats = dsec / period
        deltas.append(abs(dbeats))
        print(f"{i:>4} {l:>9.3f} {m:>9.3f} {dsec:>+7.3f} {dbeats:>+7.3f}")
    if deltas:
        mae_beats = float(np.mean(deltas))
        print(f"\n  mean |phase error| = {mae_beats:.3f} beats "
              f"({mae_beats * period:.3f} sec)")
        if mae_beats > 0.5:
            print(f"  ⚠  librosa[::4] was off by ~{round(mae_beats)} beat(s) — "
                  f"madmom's downbeats are substantially different.")
        else:
            print(f"  → librosa[::4] phase was within half-beat of madmom.")

    downbeats = madmom_downbeats.tolist()
    backend_label = "madmom"
else:
    downbeats = librosa_downbeats.tolist()
    backend_label = "librosa[::4]"

print()
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

out = {
    "duration": round(float(duration), 3),
    "bpm_global": round(float(tempo), 3),
    "beats": [round(float(t), 4) for t in beat_times],
    "downbeats": [round(float(t), 4) for t in downbeats],
    "tempo_curve": tempo_curve,
    "downbeat_backend": backend_label,
    # Empty placeholders so the BeatData type is satisfied without having to
    # run detect-drops.py and hires-energy.py. Those scripts augment this file.
    "drops": [],
    "breakdowns": [],
    "energy": [],
}

with open(OUT, "w") as f:
    json.dump(out, f)

print(f"Wrote {OUT}: {len(beat_times)} beats, {len(downbeats)} downbeats "
      f"({backend_label}), {len(tempo_curve)} tempo samples", flush=True)
