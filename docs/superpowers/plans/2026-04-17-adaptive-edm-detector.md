# Track-Agnostic EDM Structure Detector

**Date:** 2026-04-17
**Session:** main conversation + 3 parallel research agents (aeb1db5f, a4d0df89, a14b13d3)
**Status:** ready to execute

## Problem

`scripts/detect-drops.py` uses absolute dB thresholds
(`LOW_DB=-14.0`, `HIGH_DB=-4.0`, …) tuned for one mix (Dubfire). Apply it
to a different EDM subgenre (e.g. Love in Traffic — deep house, bass-present
throughout) and either every other bar looks like a breakdown or nothing
triggers at all. The user correctly called the current output "totally
random" on Love in Traffic.

## Goals

- Detect drops, breakdowns, and buildups in **any** electronic-music track
  without per-track tuning.
- Keep the JSON output shape unchanged
  (`drops: number[]`, `breakdowns: {start, end}[]`, new `buildups`) so the
  editor's Scrubber / TimelineBeatMarkers / compositions all keep working.
- Preserve the pipeline entry point: `scripts/analyze-audio.sh <audio>`
  continues to produce the same three JSON artifacts.
- Don't introduce a GPU requirement or 10x-realtime compute.

## Non-goals

- Full stem separation (Demucs). Valuable but adds ~5–10x realtime on
  CPU and a heavy dependency. Keep it as a future knob.
- Section LABELING (intro/verse/chorus/outro) à la Sony's allin1. Out of
  scope — we just need boundary + drop detection.
- msaf integration. Unmaintained since 2021. Could use pieces but don't
  depend on it.

## Approach (informed by research agents)

**Top recommendation from aeb1db5f (EDM SOTA agent):** combine
percentile-based adaptive thresholds on banded RMS with beat-synchronous
aggregation. Absolute dB is the bug; percentile rankings normalize
against the track's own distribution.

Specifically:

1. **Banded RMS features:**
   - Sub-bass 20–80 Hz (ruff out the kick fundamental / 808s).
   - Bass 80–250 Hz (kick body + bass line).
   - Mids 250–2k.
   - Highs 2k–8k (snares, claps).
   - Air 8k+ (hi-hats, cymbals, risers).

2. **Beat-synchronous aggregation:**
   - Use the already-detected beat grid from `detect-beats.py`.
   - Aggregate each band's RMS per-bar (4 beats) using median. Per-bar is
     the natural quantum for EDM structure — drops always land on
     downbeats.

3. **Adaptive thresholds (percentile-based):**
   - `bass_baseline_hi = p70(bass_per_bar)` — "loud bass" for this track.
   - `bass_baseline_lo = p25(bass_per_bar)` — "quiet bass" for this track.
   - Breakdown = contiguous run of ≥8 bars where bass ≤ bass_baseline_lo.
   - Drop-candidate bar = first bar where bass crosses back above
     bass_baseline_hi AND sub-bass onset density spikes.

4. **Buildup detection (new):**
   - HF energy slope over a rolling 8-bar window. A "buildup" is a
     sustained positive slope in highs+air energy with flat or falling
     bass — the classic riser + filtered-bass pattern.
   - Emit as `buildups: {start, end}[]`.

5. **Drop classification (post-processing):**
   - Every breakdown → the first hi-bass bar after it is its drop
     (if within a reasonable window).
   - Every buildup → the first hi-bass bar after it is its drop.
   - Dedupe drops within 1 bar of each other.

6. **Sanity guardrails:**
   - Reject tracks where beat detection failed (< 60% of duration
     covered by beats).
   - Cap max drops at `floor(duration / 30s)` — if the detector claims a
     drop every 5 seconds, something's wrong.
   - All thresholds expressible as percentiles; no absolute dB values
     anywhere in the detector.

## Output additions

Augment `<name>-beats.json` with two new fields, don't change existing:

```jsonc
{
  // existing
  "beats": [...], "downbeats": [...], "drops": [...], "breakdowns": [...],
  "energy": [...], "bpm_global": ..., "duration": ..., "tempo_curve": [...],

  // NEW
  "buildups": [{ "start": number, "end": number }, ...],
  "analysis_meta": {
    "algorithm": "adaptive-percentile-v1",
    "bass_band_hz": [80, 250],
    "bars_per_breakdown_min": 8,
    "drop_quantize": "downbeat",
    "computed_percentiles": { "bass_p25": ..., "bass_p70": ... }
  }
}
```

`buildups` gets rendered in the Scrubber (amber chip `U{n}`) per the UX
research. Consumers that don't know about it ignore it.

## Non-load-bearing simplifications

- Keep bass band simple (one percentile-based band). Sub-bass split is
  phase 2 if needed.
- No madmom dependency yet. librosa's `beat_track` + `--extend-intro`
  is already producing a usable grid. madmom's downbeat detector would
  be better but adds ~60MB of TF/PyTorch weights and maintenance has
  slowed. If librosa's beats-mod-4 downbeats turn out to be wrong on
  common tracks, add madmom as follow-up.
- Don't cache the STFT across scripts yet. Each script re-loads audio.
  Merging into one process is a later optimization.

## Verification plan

A "good" detector on Love in Traffic:
- 3–5 breakdowns (matches audible break sections).
- 3–5 drops (one per breakdown + one or two standalone builds).
- 2–4 buildups (the risers).
- Breakdowns and drops land on downbeats (within ±1 beat).

On Dubfire (Sake):
- Should produce a similar or better output than the current 11-ish
  drops it already generates. Don't regress dubfire.

Verification script: `scripts/verify-detector.py` that prints a
side-by-side of both tracks' detections and asserts sanity
guardrails pass.

## Tasks

### Task A: Adaptive detector (rewrite detect-drops.py)

- Replace absolute-dB logic with the percentile-based beat-synchronous
  approach above.
- Add `buildups` field to output.
- Preserve all existing output fields and their shapes.
- Require `beats` and `downbeats` to be present in the input JSON
  (detect-beats.py runs first in the orchestrator already).
- Add `analysis_meta` block for debuggability.
- Keep the script's CLI: `--audio`, `--beats-json`.

Acceptance:
- Runs on `public/love-in-traffic.mp3` without error.
- Produces 3–5 drops and 3–5 breakdowns (not 6 drops scattered randomly).
- Produces ≥1 buildup.
- Runs on `public/dubfire-sake.wav` without regression (similar or
  better detection than the current output).

### Task B: Verification script

- Create `scripts/verify-detector.py` that loads a beats JSON and
  prints:
  - Number of drops, breakdowns, buildups.
  - Whether drops fall on downbeats (within ±1 beat).
  - Whether drop-density is sane (< duration / 30s).
  - Breakdown/buildup/drop overlap checks.
- Exits non-zero if guardrails fail.
- Runs as the last step in `scripts/analyze-audio.sh`.

Acceptance:
- Both tracks pass the guardrails after re-running the pipeline.
- Any failure prints a clear "why" line.

### Task C: Render buildups in the Scrubber

- Add amber-colored buildup rendering in `editor/src/components/Scrubber.tsx`:
  dashed 1.5px left/right borders, 8% amber fill, `U{n}` chip at top-left.
- Update `editor/src/types.ts` BeatData type to include
  `buildups?: {start: number; end: number}[]` (optional, for backwards
  compat with older JSONs that predate Task A).

Acceptance:
- Scrubber shows amber bands during buildups on love-in-traffic.
- Still works on tracks whose JSON doesn't have `buildups` (shouldn't
  crash).

### Task D: Regenerate artifacts + verify end-to-end

- Run `scripts/analyze-audio.sh public/love-in-traffic.mp3`.
- Run `scripts/analyze-audio.sh public/dubfire-sake.wav` (if the WAV is
  still present).
- Confirm verify-detector.py passes on both.
- Visually confirm the Scrubber in the editor shows sensible drops +
  breakdowns + buildups on love-in-traffic.

Acceptance:
- Both JSON files updated and committed.
- Manual sanity check on the Scrubber looks reasonable.

## Risks & open questions

- **Percentiles assume the whole track has structure.** A track that's
  uniformly energetic (e.g. a loop track or a DJ set edit) will still
  get drops / breakdowns flagged because p25 ≠ p70 by definition. We
  need a guardrail: if `p70 - p25 < small_delta_db`, skip drop detection
  (no meaningful structure). Will add in Task A.
- **Downbeat alignment depends on beats mod 4.** librosa's beat_track
  doesn't report phase; beats[::4] is only correct if the first beat is
  a downbeat. Should compute downbeat phase from snare/kick onset
  energy — flag as follow-up if it causes visible drift.
- **Buildup detection is a new concept.** We've never emitted buildups
  before. A subtle bug could emit a buildup covering the whole track.
  Verification script guards against this.
