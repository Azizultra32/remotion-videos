"""Slice an existing marked Pioneer waveform PNG between its visible line markers."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


def find_line_clusters(im: Image.Image, min_bright_rows_ratio: float = 0.2) -> list[tuple[int, int]]:
    rgb = im.convert("RGB")
    w, h = rgb.size
    min_bright_rows = int(h * min_bright_rows_ratio)
    bright_cols: list[int] = []
    for x in range(w):
        bright = 0
        for y in range(h):
            r, g, b = rgb.getpixel((x, y))
            if r > 230 and g > 230 and b > 230:
                bright += 1
        if bright >= min_bright_rows:
            bright_cols.append(x)
    if not bright_cols:
        return []
    clusters: list[tuple[int, int]] = []
    start = prev = bright_cols[0]
    for x in bright_cols[1:]:
        if x == prev + 1:
            prev = x
            continue
        clusters.append((start, prev))
        start = prev = x
    clusters.append((start, prev))
    return clusters


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--image", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--pad", type=int, default=1)
    p.add_argument("--y-top", type=int, default=0)
    p.add_argument("--y-bottom", type=int, default=None)
    p.add_argument(
        "--stem",
        default=None,
        help=(
            "Audio stem. When set, writes protocol-compliant filenames "
            "<stem>-phase2-segment-NN.png and <stem>-phase2-manifest.json "
            "instead of the default slice-NN.png + slices.json."
        ),
    )
    p.add_argument(
        "--audio",
        default=None,
        help=(
            "Optional source-audio path recorded in the stem manifest's "
            "source_audio field. Falls back to the input PNG basename."
        ),
    )
    p.add_argument(
        "--duration-sec",
        type=float,
        default=None,
        help=(
            "Optional total audio duration in seconds. When set, enables "
            "px->sec mapping for start_sec / end_sec in the stem manifest."
        ),
    )
    args = p.parse_args()

    src = Path(args.image)
    im = Image.open(src)
    w, h = im.size
    y0 = max(0, args.y_top)
    y1 = h if args.y_bottom is None else min(h, args.y_bottom)
    clusters = find_line_clusters(im)
    if not clusters:
        raise SystemExit("No white vertical cut lines detected in source PNG.")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    stem = args.stem
    duration_sec = args.duration_sec

    def _px_to_sec(px: int) -> float | None:
        if duration_sec is None or w <= 0:
            return None
        return round(duration_sec * (px / w), 3)

    def _slice_filename(i: int) -> str:
        if stem:
            return f"{stem}-phase2-segment-{i:02d}.png"
        return f"slice-{i:02d}.png"

    slices = []
    x0 = 0
    for i, (start, end) in enumerate(clusters, start=1):
        x1 = max(0, start - args.pad)
        if x1 > x0:
            out_name = _slice_filename(i)
            out_path = out_dir / out_name
            im.crop((x0, y0, x1, y1)).save(out_path)
            slices.append({
                "index": i,
                "x0": x0,
                "x1": x1,
                "width": x1 - x0,
                "image": str(out_path),
                "filename": out_name,
                "start_px": x0,
                "end_px": x1,
                "start_sec": _px_to_sec(x0),
                "end_sec": _px_to_sec(x1),
            })
        x0 = min(w, end + 1 + args.pad)
    if x0 < w:
        i = len(slices) + 1
        out_name = _slice_filename(i)
        out_path = out_dir / out_name
        im.crop((x0, y0, w, y1)).save(out_path)
        slices.append({
            "index": i,
            "x0": x0,
            "x1": w,
            "width": w - x0,
            "image": str(out_path),
            "filename": out_name,
            "start_px": x0,
            "end_px": w,
            "start_sec": _px_to_sec(x0),
            "end_sec": _px_to_sec(w),
        })

    if stem:
        source_audio = args.audio if args.audio else src.name
        stem_segments = [
            {
                "filename": s["filename"],
                "start_sec": s["start_sec"] if s["start_sec"] is not None else 0.0,
                "end_sec": s["end_sec"] if s["end_sec"] is not None else 0.0,
                "start_px": s["start_px"],
                "end_px": s["end_px"],
            }
            for s in slices
        ]
        manifest = {
            "source_audio": source_audio,
            "source_png": f"{stem}-phase1-confirmed-full.png",
            "segments": stem_segments,
        }
        manifest_name = f"{stem}-phase2-manifest.json"
    else:
        manifest = {
            "source_image": str(src),
            "source_size": [w, h],
            "y_crop": [y0, y1],
            "line_clusters": clusters,
            "slices": slices,
        }
        manifest_name = "slices.json"

    (out_dir / manifest_name).write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Detected line clusters: {clusters}")
    print(f"Wrote {len(slices)} slices to {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
