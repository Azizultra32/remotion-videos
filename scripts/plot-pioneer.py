"""Render a mirrored Pioneer/rekordbox-style 3Band waveform from audio data."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import librosa
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.ticker import FuncFormatter, MultipleLocator
from scipy.signal import butter, sosfiltfilt


BAND_DEFS = [
    ("low", 40.0, 180.0, "#2a6fff", 1),
    ("mid", 180.0, 2000.0, "#ff8c1a", 2),
    ("high", 2000.0, 8000.0, "#f5eadd", 3),
]


def bandpass(y: np.ndarray, sr: int, lo: float, hi: float) -> np.ndarray:
    nyq = sr / 2.0
    sos = butter(
        4,
        [max(1e-4, lo / nyq), min(0.999, hi / nyq)],
        btype="bandpass",
        output="sos",
    )
    return sosfiltfilt(sos, y)


def column_envelope(y: np.ndarray, cols: int) -> np.ndarray:
    step = max(1, len(y) // cols)
    trimmed = y[: (len(y) // step) * step]
    bins = trimmed.reshape(-1, step)
    return np.max(np.abs(bins), axis=1)


def load_event_times(path: str) -> list[float]:
    data = json.loads(Path(path).read_text())
    for key in ("events", "major_events_sec", "phase1_events_sec", "phase2_events_sec"):
        vals = data.get(key)
        if isinstance(vals, list):
            return [float(v) for v in vals]
    return []


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--audio", required=True)
    p.add_argument("--beats", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--width", type=int, default=1800)
    p.add_argument("--height", type=int, default=360)
    p.add_argument("--sr", type=int, default=22050)
    p.add_argument("--t-start", type=float, default=None)
    p.add_argument("--t-end", type=float, default=None)
    p.add_argument("--tick-every", type=float, default=None)
    p.add_argument("--minor-every", type=float, default=None)
    p.add_argument("--local-time", action="store_true")
    p.add_argument("--hide-events", action="store_true")
    p.add_argument("--hide-event-labels", action="store_true")
    p.add_argument("--no-title", action="store_true")
    args = p.parse_args()

    y, sr = librosa.load(args.audio, sr=args.sr, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))
    cols = args.width
    t_cols = np.linspace(0.0, duration, cols)

    envs: dict[str, np.ndarray] = {}
    for name, lo, hi, _, _ in BAND_DEFS:
        env = column_envelope(bandpass(y, sr, lo, hi), cols)
        if env.shape[0] != cols:
            env = np.interp(np.linspace(0, 1, cols), np.linspace(0, 1, env.shape[0]), env)
        peak = float(np.percentile(env, 99.5)) + 1e-12
        envs[name] = np.clip(env / peak, 0.0, 1.0)

    dpi = 100
    fig, ax = plt.subplots(figsize=(args.width / dpi, args.height / dpi), dpi=dpi)
    fig.patch.set_facecolor("#000")
    ax.set_facecolor("#000")

    for name, lo, hi, color, z in BAND_DEFS:
        env = envs[name]
        ax.fill_between(t_cols, -env, env, color=color, linewidth=0, zorder=z)

    t_start = 0.0 if args.t_start is None else float(args.t_start)
    t_end = duration if args.t_end is None else float(args.t_end)
    ax.set_xlim(t_start, t_end)
    ax.set_ylim(-1.1, 1.25)
    ax.set_yticks([])

    if not args.hide_events:
        event_times = load_event_times(args.beats)
        for ev_t in event_times:
            ax.axvline(ev_t, color="#ffffff", linewidth=3.0, alpha=1.0, zorder=10)
            if not args.hide_event_labels:
                ax.text(
                    ev_t,
                    1.12,
                    f"{int(ev_t // 60)}:{ev_t % 60:05.2f}",
                    color="#ffffff",
                    fontsize=8,
                    va="top",
                    ha="center",
                    clip_on=False,
                    fontweight="bold",
                    zorder=11,
                )

    ax.tick_params(colors="#888")
    for s in ax.spines.values():
        s.set_color("#333")
    ax.grid(which="major", axis="x", color="#333", linewidth=0.5, zorder=0)
    ax.grid(which="minor", axis="x", color="#262626", linewidth=0.35, zorder=0)

    span = t_end - t_start
    if args.tick_every is not None:
        major = args.tick_every
    elif not args.local_time and span > 300:
        major = 15.0
    elif span <= 40:
        major = 2.0
    elif span <= 120:
        major = 10.0
    else:
        major = 30.0
    if args.minor_every is not None:
        minor = float(args.minor_every)
    else:
        minor = 5.0 if (not args.local_time and span > 300) else max(major / 10.0, 0.25)
    ax.xaxis.set_major_locator(MultipleLocator(major))
    ax.xaxis.set_minor_locator(MultipleLocator(minor))

    def fmt_mmss(sec, _):
        if args.local_time:
            sec = sec - t_start
        sec = max(0, round(sec, 1))
        m = int(sec // 60)
        s = sec - m * 60
        if major < 10:
            return f"{m}:{s:04.1f}"
        return f"{m}:{int(s):02d}"

    ax.xaxis.set_major_formatter(FuncFormatter(fmt_mmss))
    ax.set_xlabel("time", color="#ccc")
    ax.tick_params(axis="x", labelsize=7 if (not args.local_time and span > 300) else 8, pad=2)
    for label in ax.get_xticklabels():
        label.set_rotation(90 if (not args.local_time and span > 300) else 0)
        label.set_ha("center")

    ax.text(
        0.005,
        0.02,
        "blue = low (40-180 Hz)    orange = mid (180-2k Hz)    white = high (2-8k Hz)",
        transform=ax.transAxes,
        color="#aaa",
        fontsize=8,
        va="bottom",
    )

    if not args.no_title:
        fig.suptitle(
            f"{os.path.basename(args.audio)}   ·   {duration/60:.2f} min   ·   rekordbox 3Band-style mirrored waveform",
            color="#ddd",
            fontsize=11,
            y=0.98,
        )

    fig.subplots_adjust(bottom=0.22 if (not args.local_time and span > 300) else 0.14)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=dpi, facecolor=fig.get_facecolor(), bbox_inches="tight", pad_inches=0.3)
    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
