# Analysis Workflow Lock-In — Implementation Plan

> Executes spec at `docs/superpowers/specs/2026-04-18-analysis-workflow-lockin-design.md` (commit `2ff6b6c`). Four tasks. A/B/C are independent and can run in parallel; D is end-to-end verification once A+B land.

**Goal:** `npm run mv:analyze -- --project <stem>` runs the full Phase 1 + Phase 2 workflow end-to-end from any terminal, drops artifacts in `projects/<stem>/analysis/` per the filename convention, and updates `projects/<stem>/analysis.json`.

**Engine-lock note:** every file touched is engine-locked (`scripts/**`, `docs/**`, `.claude/**`). Implementer subagents must use the Bash-heredoc / Python write pattern because this session lacks `ENGINE_UNLOCK=1`. Bash tool isn't hook-gated.

---

## Task A — `slice-pioneer-png.py` emits protocol-compliant names

**File:** `scripts/slice-pioneer-png.py` (modify).

- Add optional `--stem <audio-stem>` CLI flag.
- When `--stem` passed: segment PNGs named `<stem>-phase2-segment-NN.png`, manifest named `<stem>-phase2-manifest.json`, manifest shape `{ source_audio, source_png, segments: [{ filename, start_sec, end_sec, start_px, end_px }] }`.
- When `--stem` omitted: keep existing behavior (`slice-NN.png` + `slices.json`).
- Verify: run once with `--stem test` on an existing confirmed-full PNG, confirm files land with correct names and manifest is valid JSON with the expected keys. Run once without `--stem`, confirm old-style files appear.

---

## Task B — `mv:analyze` runs end-to-end

**File:** `scripts/cli/mv-analyze.ts` (rewrite post-Setup).

- Keep existing args: `--project <stem>` required, `--setup-only` optional.
- Add: `--no-copy` (skip updating root `analysis.json`).
- Setup (unchanged): run `energy-bands.py`, then `plot-pioneer.py --hide-events` to produce `<stem>-full.png` and `source.json`.
- Read master prompt from `docs/waveform-analysis-protocol.md` (extract the ```text``` fenced block).
- Substitute `<AUDIO_PATH>`, `<AUDIO_STEM>`, `<OUT_DIR>` in the prompt.
- Spawn `claude -p "<prompt>"` via `spawn("claude", ["-p", prompt], { stdio: "inherit" })` so the operator sees progress live.
- On child exit 0: unless `--no-copy`, copy `<OUT_DIR>/<stem>-phase2-events.json` to `projects/<stem>/analysis.json`; print a summary (event count + paths).
- On child non-zero: propagate exit code; print tail of stderr if possible.
- Handle missing `claude` binary: if spawn fails with ENOENT, print a clear "claude CLI not installed" message and exit 2.

---

## Task C — Documentation updates

**Files:** `.claude/skills/analyze-music/SKILL.md`, `CLAUDE.md`.

- In `SKILL.md`: replace the "Paste the printed prompt into a fresh Claude Code session" paragraph and the "Why not one-shot?" paragraph with one paragraph explaining `npm run mv:analyze -- --project <stem>` is now end-to-end.
- In `CLAUDE.md`: change the `mv:analyze` one-liner from "run Setup + print master prompt" to "run full end-to-end analysis (Setup + Phase 1 + Phase 2)."
- Do NOT modify `docs/waveform-analysis-protocol.md` — master prompt stays authoritative.

---

## Task D — End-to-end verification

- Clean `projects/as-the-rush-comes/analysis/`.
- Run `npm run mv:analyze -- --project as-the-rush-comes` from a fresh shell.
- Wait up to 10 minutes.
- Verify: exit 0, all expected artifacts present per Acceptance Criteria 1-2 in the spec, `analysis.json` at project root updated, Scrubber displays new `phase2-confirmed-full.png` on editor refresh.
- Record: commit SHA of each of A/B/C, verification output, event count.

---

## Execution plan

1. Dispatch implementer subagents for A, B, C in parallel (independent files, no conflicts).
2. When all three land: dispatch verifier subagent for D.
3. Commit each change on landing; push after D passes.

Review depth: quick spec-compliance check per implementer (no separate code-quality reviewer pass this round — user asked for speed).
