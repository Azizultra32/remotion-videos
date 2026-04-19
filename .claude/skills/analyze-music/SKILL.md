---
name: analyze-music
description: Use this skill when the user wants to find event points (drops, breakdowns, major moments) on a track's waveform. Invokes the Python Setup pipeline and then drives the multi-agent visual review protocol that produces phase1 and phase2 confirmed event timestamps.
---

# Analyze Music — Event-Point Detection

## When to use

Invoke on user intents like:
- "find the drops in love-in-traffic"
- "analyze this track"
- "where are the major event points?"
- "run phase 1 and 2 on rush-comes"

Do NOT invoke for track editing or rendering — that's the `music-video-workflow` skill.

## Output

A successful run produces, under `projects/<stem>/analysis/`:

- `source.json` — `energy-bands.py` output (bulk data, not for the editor)
- `full.png` — unmarked mirrored 3Band waveform
- `phase1-confirmed-full.png` — full waveform with Phase 1 lines placed
- `phase1-events.json` — `{ source_audio, phase1_events_sec: [t1, …] }`
- `phase1-zoom-NN.png` — one per Phase 1 candidate (2–5 total)
- `phase2-confirmed-full.png` — final waveform with all confirmed lines
- `phase2-events.json` — merged Phase 1 + Phase 2 list, ascending
- `phase2-manifest.json` — segment → source boundaries
- `phase2-segment-NN.png` — one per segment
- `phase2-segment-NN-zoom-MM.png` — per-segment internal zooms

Plus the editor-facing canonical file at the project root:
- `projects/<stem>/analysis.json` — the thin events list the Scrubber reads

## Protocol

The authoritative protocol is [`docs/waveform-analysis-protocol.md`](../../../docs/waveform-analysis-protocol.md). Read it fully before starting. Key rules:

1. **No detectors, no novelty scoring, no taxonomy** (don't call anything a "drop" or "breakdown" — just "event point").
2. **Initial full PNG generated ONCE** by `plot-pioneer.py` in Setup, never re-rendered. No "scouts", no render variants.
3. **Filenames MUST match the closed-set convention** — `analysis`, `full`, `zoom`, `segment`, `manifest`, `events`, `confirmed-full`. Any other filename is a protocol violation; stop, delete, resume.
4. **Subagents default to CONFIRM**. Only return "no event in zoom" as a narrow fallback.
5. **Phase 2 zoom filenames are per-segment-scoped**: `<stem>-phase2-segment-NN-zoom-MM.png`. Numbering restarts per segment. A segment can have 0–4 internal zooms.

## Running

### Setup only (fast — just the Python scripts)

```bash
npm run mv:analyze -- --project <stem> --setup-only
```

Produces `source.json` + `full.png` and stops. Useful for checking that analysis inputs are clean before kicking off the full multi-agent review.

### Full workflow

```bash
npm run mv:analyze -- --project <stem>
```

Runs Setup (Python `energy-bands.py` + `plot-pioneer.py`), then spawns `claude -p` with the master prompt substituted, which executes Phase 1 (candidate identification + per-candidate zoom confirmation) and Phase 2 (segment slicing + per-segment internal zoom confirmation) autonomously. On exit, copies the final `phase2-events.json` to `projects/<stem>/analysis.json` so the editor's Scrubber picks up the new event set on next refresh.

Wall clock: 5-10 minutes depending on track length and candidate count. Progress streams to the terminal in real time. This is end-to-end: no prompt-pasting step.

## Driving Phases 1–2 as the main agent

> In most cases, just use `mv:analyze` — this section is the fallback for when you need to invoke the protocol manually.

If you're the main agent that received the master prompt:

1. Read `full.png` (the initial unmarked waveform). **Do not re-render it.**
2. Identify 2–5 major event points visually. Don't invent more than 5; don't settle for fewer than 2. Don't use any taxonomy language.
3. For each candidate, render a zoom around it using `plot-pioneer.py --t-start <s-8> --t-end <s+8> --local-time --hide-events --out <stem>-phase1-zoom-NN.png`.
4. Dispatch one fresh subagent per zoom (parallel) with ONLY the zoom image path + window bounds. Subagent returns `confirmed_sec: <float>`.
5. Collect the confirmed timestamps. Write `phase1-events.json` with `{ source_audio, phase1_events_sec: [ascending timestamps] }`.
6. Render `phase1-confirmed-full.png` by calling `plot-pioneer.py --beats phase1-events.json --out <stem>-phase1-confirmed-full.png --hide-event-labels`.
7. Begin Phase 2 (slice, zoom, confirm, render `phase2-confirmed-full.png` and `phase2-events.json`).

Full protocol in `docs/waveform-analysis-protocol.md`.

## Pointing the editor at the output

After a successful run, copy the final events into the project's canonical `analysis.json`:

```bash
cp projects/<stem>/analysis/phase2-events.json projects/<stem>/analysis.json
```

The editor's `useBeatData` normalizer picks up the new `phase2_events_sec` key on the next reload (or file-watch event). Scrubber overlay reflects the confirmed lines.

## What NOT to do

- Don't modify `docs/waveform-analysis-protocol.md` — it's engine-locked. If you find a protocol bug, tell the user; they'll unlock and fix.
- Don't skip Setup and try to work from a stale full.png — the protocol explicitly forbids re-using waveform images across runs.
- Don't label files with taxonomy (`drop-01`, `breakdown-02`, `scout-broad`, `q1`) — closed-set whitelist only.
- Don't try to confirm events yourself as the main agent — the subagent step is load-bearing for accuracy.
