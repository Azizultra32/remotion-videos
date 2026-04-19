# Analysis Workflow — Architecture Lock-In (Sub-project 1)

**Status:** approved 2026-04-18; implementation next.
**Scope:** make the multi-agent waveform-analysis workflow run end-to-end from a single terminal command, produce its artifacts in the canonical per-project locations, and integrate with the editor's auto-display path that already ships.

This is Sub-project 1 of a 2-part series. Sub-project 2 (editor UI polish — stage strip during analysis, event cycler after, locked placeholder elements, beat-snap on markers) is out of scope here and will have its own spec.

---

## Goal

Reproducibly run the full Phase 1 + Phase 2 workflow from any terminal (or fresh Claude Code session) with one command, dropping all outputs in `projects/<stem>/analysis/` per the existing filename convention, and updating `projects/<stem>/analysis.json` so the editor's Scrubber picks up the confirmed event PNG automatically on next track-switch.

## Why now

This session demonstrated the workflow working end-to-end via a Task-agent dispatch (6 confirmed events for `as-the-rush-comes`, full artifact set under `projects/as-the-rush-comes/analysis/`, Scrubber now displaying `phase2-confirmed-full.png`). But the CLI (`mv:analyze`) today stops after Setup and prints the master prompt for a human to paste into another session. Second-run reliability depends on re-establishing context the person doing the pasting doesn't have. Locking this in means removing the paste step.

## Non-goals

- UI for live-progress during analysis (stage strip / event cycler / lock-unlock / beat-snap) — Sub-project 2.
- Re-run diff semantics (what happens when a second analysis produces different timestamps than what's in `analysis.json`) — Sub-project 2.
- Caching / partial-run resume — deferred.

---

## The four changes

### 1. `scripts/cli/mv-analyze.ts` runs end-to-end

**File:** `scripts/cli/mv-analyze.ts` (modify).

Today: runs `energy-bands.py` + `plot-pioneer.py`, then prints the master prompt text for the operator to paste somewhere else.

After:
1. Parse args: `--project <stem>` (required), `--setup-only` (optional, existing behavior), `--no-copy` (optional, skip updating the root `analysis.json`).
2. Run Setup (unchanged): `energy-bands.py --audio ... --out .../analysis/source.json`, then `plot-pioneer.py --audio ... --beats .../analysis/source.json --out .../analysis/<stem>-full.png --hide-events`.
3. Read `docs/waveform-analysis-protocol.md`, extract the ```text``` fenced block, substitute `<AUDIO_PATH>`, `<AUDIO_STEM>`, `<OUT_DIR>`.
4. Spawn `claude -p "<prompt>"` with stdio piped to this process's stderr so the operator sees progress. The child runs Phase 1 + Phase 2 autonomously (uses Read / Bash / Write tools; emulates fresh-subagent isolation via per-zoom reads — proven working in this session).
5. On child exit 0:
   - Unless `--no-copy`: copy `<OUT_DIR>/<stem>-phase2-events.json` to `projects/<stem>/analysis.json`.
   - Print summary: event count + location of `phase2-confirmed-full.png` + the flat event list.
6. On child non-zero: propagate exit code, print tail of stderr, leave partial artifacts in place so the operator can inspect.

Shape of the stdio pipeline:
```
[ mv-analyze.ts ]
     ↓ stdout:  "[mv:analyze] Setup ...", "[mv:analyze] spawning claude -p ..."
     ↓ pipes claude's stdout+stderr through
     ↓ stdout:  (claude's own progress lines, tool-use markers, final report)
     ↓ on success: copies phase2-events.json → analysis.json, prints summary
     └ exit 0
```

### 2. `scripts/slice-pioneer-png.py` emits protocol-compliant names

**File:** `scripts/slice-pioneer-png.py` (modify).

Today: outputs `slice-01.png`, `slice-02.png`, `slices.json` in the configured out-dir. The orchestrator has to rename each file to `<stem>-phase2-segment-NN.png` and author a protocol-compliant manifest — a real gap flagged by the Task-agent run this session.

After: add `--stem <audio-stem>` (optional for backward compat). When `--stem` is passed:
- Segment PNGs named `<stem>-phase2-segment-NN.png` directly.
- Manifest written as `<stem>-phase2-manifest.json` with the schema the protocol expects:
  ```json
  {
    "source_audio": "<AUDIO_PATH>",
    "source_png": "<stem>-phase1-confirmed-full.png",
    "segments": [
      { "filename": "<stem>-phase2-segment-01.png",
        "start_sec": 0.0, "end_sec": 251.0,
        "start_px": 0, "end_px": 670 },
      ...
    ]
  }
  ```
- When `--stem` is omitted, keep the old names (don't break pre-existing manual invocations).

### 3. Editor auto-display — no change needed

Already shipped in commit `69bf57f`: Scrubber probes for `/api/projects/<stem>/analysis/<stem>-phase2-confirmed-full.png` on audioSrc change; displays it as the waveform image when present; falls back to `phase1-confirmed-full.png`; falls back to wavesurfer + SVG markers when no PNG exists. The `analysis.json` at the project root is what `useBeatData` reads for the event count in the header.

This section is listed for completeness; no changes required for Sub-project 1.

### 4. Documentation tightening

**`.claude/skills/analyze-music/SKILL.md`:**
- Replace the "Paste the printed prompt into a fresh Claude Code session" paragraph with: "Run `npm run mv:analyze -- --project <stem>` from any terminal. The command is end-to-end — Setup, Phase 1 (multi-agent confirmation), Phase 2 (segmentation + internal confirmation), final artifact write."
- Drop the "Why not one-shot?" paragraph — it's no longer accurate.
- Keep the protocol rules section + filename-table pointer (still authoritative).

**`CLAUDE.md`:**
- Update the `mv:analyze` bullet from "run Setup + print master prompt" to "run the full multi-agent analysis workflow end-to-end."

**`docs/waveform-analysis-protocol.md`:**
- Unchanged. The master prompt is the single source of truth; `mv:analyze` substitutes `<AUDIO_PATH>`, `<AUDIO_STEM>`, `<OUT_DIR>` at invocation time.

---

## Acceptance criteria

1. **`npm run mv:analyze -- --project as-the-rush-comes`** from a newly-opened terminal (no prior Claude session, no prior analysis artifacts) runs to completion with exit 0. Wall-clock is acceptable up to ~10 min.
2. All protocol-compliant artifacts are present under `projects/as-the-rush-comes/analysis/`: `source.json`, `full.png`, `phase1-zoom-01..NN.png`, `phase1-events.json`, `phase1-confirmed-full.png`, `phase2-segment-01..NN.png`, `phase2-manifest.json`, `phase2-segment-NN-zoom-MM.png` (zero or more), `phase2-events.json`, `phase2-confirmed-full.png`.
3. `projects/as-the-rush-comes/analysis.json` (root of the project) is updated to match `phase2-events.json` in schema (`{ "source_audio": ..., "phase2_events_sec": [...] }`).
4. No manual rename step required — slicer emits compliant names directly.
5. Editor hard-refresh on `as-the-rush-comes`: Scrubber shows the new `phase2-confirmed-full.png`; header counter shows the new event count.
6. A fresh Claude Code session in a newly-cloned repo, loaded only with `CLAUDE.md` + the two project skills, can discover and successfully run the workflow without needing any session-specific context from this conversation.
7. `npx tsc --noEmit` and existing editor tests still pass after the changes.

---

## Risks

**R1 — `claude -p` tool surface.** The multi-agent workflow needs Read + Bash + Write tools. If `claude -p` restricts any of these in a way that prevents Phase 1/2 from completing, `mv:analyze` has to fall back to an alternate driver (e.g., a custom orchestrator using the Anthropic SDK). Mitigation: this session's Task-agent run emulated fresh-subagent isolation via per-zoom reads without dispatching actual subagents, and worked. `claude -p` should be at least that capable. If it isn't, we'll flag early and the fallback is small additional code, not a redesign.

**R2 — Long-running child, rate limits, cancellation.** A full run is 5–10 minutes of API time. `mv:analyze` needs to:
- Stream child stdout so the operator sees progress.
- Detect HTTP 429 from the child's output or exit code and print a "rate-limited; retry after Ns" line rather than silently failing.
- Respond to SIGINT in the parent by killing the child group cleanly, not just the wrapper.
These are standard process-management concerns, handled in the implementation plan.

**R3 — Legacy `slice-pioneer-png.py` invocations.** Adding `--stem` as an optional parameter should be safe. Explicit test: run it without `--stem` and confirm the original `slice-NN.png` + `slices.json` outputs still materialize. Guard in code with an `if args.stem:` branch.

---

## Out of scope (deferred to Sub-project 2)

- Live stage-strip UI ("Setup / Phase 1 Review / Zoom N / Phase 1 Done / ...") lighting up in the editor during analysis.
- Event cycler (prev/next buttons, current-event highlight on Scrubber, jump-to-event playhead sync, element selection).
- Auto-populated locked placeholder `text.bellCurve` elements at each event time.
- Beat-snap on markers (Sub-project 2 feature, not applicable to detection quality).
- Re-run diff semantics: when a second analysis produces different timestamps, what happens to existing locked placeholders + user edits. (Decision needs its own design pass.)
- Analysis.json file watcher on the editor side (currently the editor only rehydrates on stem-switch; a new analysis run requires a manual reload).

---

## Implementation order (preview for writing-plans)

1. Task A: `scripts/slice-pioneer-png.py` — add `--stem` flag; verify backward compat.
2. Task B: `scripts/cli/mv-analyze.ts` — full rewrite of the post-Setup phase; spawn claude; stream stdio; copy on success.
3. Task C: Documentation updates (`SKILL.md`, `CLAUDE.md`).
4. Task D: End-to-end verification: clean `projects/as-the-rush-comes/analysis/`; run `npm run mv:analyze`; confirm all artifacts + editor refresh + headless-browser screenshot.

Tasks A and B are independent; doc task can happen after either lands. Verification closes the loop.
