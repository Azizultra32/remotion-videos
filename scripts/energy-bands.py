"""Compute low/mid/high energy envelopes from an audio file.

This script is intentionally neutral. It does not infer events, breakdowns,
or drops. It only measures three band envelopes and stores them in JSON so the
waveform plot can be rendered from scratch without using legacy metadata.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import librosa
import numpy as np


BANDS = {
    "low": (40.0, 180.0),
    "mid": (180.0, 2000.0),
    "high": (2000.0, 8000.0),
}


def to_db(values: np.ndarray) -> np.ndarray:
    values = np.maximum(values, 1e-12)
    ref = float(np.max(values)) + 1e-12
    return 20.0 * np.log10(values / ref)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--audio", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--sr", type=int, default=22050)
    p.add_argument("--hop-sec", type=float, default=0.1)
    p.add_argument("--n-fft", type=int, default=4096)
    args = p.parse_args()

    y, sr = librosa.load(args.audio, sr=args.sr, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))
    hop_length = max(1, int(round(sr * args.hop_sec)))
    S = np.abs(librosa.stft(y, n_fft=args.n_fft, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=args.n_fft)
    times = librosa.frames_to_time(np.arange(S.shape[1]), sr=sr, hop_length=hop_length)

    energy_bands = {}
    for name, (lo, hi) in BANDS.items():
        idx = np.where((freqs >= lo) & (freqs < hi))[0]
        band_mag = np.sqrt(np.mean(S[idx, :] ** 2, axis=0)) if len(idx) else np.zeros(S.shape[1])
        band_db = to_db(band_mag)
        energy_bands[name] = [
            {"t": round(float(t), 3), "db": round(float(db), 3)}
            for t, db in zip(times, band_db)
        ]

    out_path = Path(args.out)
    if out_path.exists():
        data = json.loads(out_path.read_text())
    else:
        data = {}
    data.update({
        "source_audio": args.audio,
        "duration_sec": round(duration, 6),
        "sample_rate_hz": sr,
        "energy_bands": energy_bands,
        "energy_bands_meta": {
            "hop_sec": args.hop_sec,
            "n_fft": args.n_fft,
            "bands_hz": {k: [v[0], v[1]] for k, v in BANDS.items()},
        },
    })
    out_path.write_text(json.dumps(data, indent=2) + "\n")
    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
