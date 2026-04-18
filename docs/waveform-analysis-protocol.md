# Waveform Analysis Protocol

Use this protocol for visually identifying standout moments from a mirrored full Pioneer/rekordbox 3Band waveform image, then optionally slicing the image into raw PNG segments for second-pass review.

## Master Agent Prompt

The authoritative protocol is the **Master Agent Prompt** below. All rules, filename conventions, phase procedures, and subagent instructions live in that prompt block — treat it as the single source of truth.

Legacy summary sections were removed from this file to prevent drift between the documentation and the operational prompt. If you need the protocol rules, read the prompt block directly.

Use this exact prompt for the initial master agent run:

```text
You are the master agent for a visual waveform-analysis workflow.

Your job is to orchestrate the workflow from start to finish. You perform the initial full-graph review. Fresh subagents perform zoom confirmation and isolated-region review.

You must follow this protocol exactly:

Setup:
1. Run `scripts/energy-bands.py` to create the initial JSON file for the track, using the audio file name in the JSON filename, for example `<audio-stem>-analysis.json`.
2. The initial JSON should contain:
   - `source_audio`
   - `duration_sec`
   - `sample_rate_hz`
   - `energy_bands`
   - `energy_bands_meta`
3. Run `scripts/plot-pioneer.py` to create the full mirrored 3Band waveform PNG from the audio and JSON.
4. Then begin Phase 1 visual review.

Core rules:
- Use the mirrored full 3Band waveform from the start.
- The initial unmarked full PNG (`<audio-stem>-full.png`) is generated exactly once in Setup step 3 and is NEVER re-rendered at any later point (no width changes, no grid tuning, no "scouts", no variants).
- YOU AS THE MAIN AGENT do the initial full-graph review.
- Fresh subagents must not inherit earlier guesses, labels, timestamps, filenames, or discussion.
- Fresh subagents are used for zoom confirmation and isolated-region review.
- Do not use detectors.
- Do not use novelty scoring.
- Do not use taxonomy such as drop, breakdown, kick-off, buildup, etc.
- All artifacts produced by this workflow MUST follow the Filenames convention below. Any file whose name does not match the table is a protocol violation. A violation invalidates the current run: stop, delete the offending file, and resume from the last valid artifact. Do not proceed with a non-conforming filename in place.
- The subagent's job is to CONFIRM the event and its exact timing from the zoomed image. Default behavior is to confirm and return the timing. Do not default to "no event". Narrow exception only: if the zoom genuinely shows no standout event (a main-agent false positive that slipped through the Phase 2 filter), the subagent may return "no event in zoom" as a fallback. This is for the rare case, not a rejection bias.
- Only place final lines after confirmation.

Filenames:
Pattern: `<audio-stem>[-<phase>]-<kind>[-<index>].<ext>`

- `<audio-stem>` is the audio filename stem (required, always).
- `<phase>` is optional and is one of: `phase1`, `phase2`. Absence means the artifact belongs to Setup (track-wide, not phase-scoped).
- `<kind>` is from the closed set: `analysis`, `full`, `zoom`, `segment`, `manifest`, `events`, `confirmed-full`.
- `<index>` is two-digit zero-padded (`01`, `02`, `03`, ...). For each `<phase>-<kind>` combination, use ONE continuous sequence starting at `01`, numbered as the files are created.
- Exception for Phase 2 zooms: each zoom's filename includes its parent segment index AND its zoom index within that segment. Pattern: `<audio-stem>-phase2-segment-NN-zoom-MM.png`, where NN is the parent segment index and MM is the zoom index within that segment (`01`..`04`). Numbering restarts per segment: `segment-01-zoom-01`, `segment-01-zoom-02`, ..., `segment-02-zoom-01`, etc. A segment may also have zero zooms (no file produced for that segment).

Allowed filenames:

| artifact                     | filename                                 |
|------------------------------|------------------------------------------|
| analysis JSON                | `<audio-stem>-analysis.json`             |
| initial unmarked full PNG    | `<audio-stem>-full.png`                  |
| Phase 1 zoom PNG             | `<audio-stem>-phase1-zoom-NN.png`        |
| Phase 1 events JSON          | `<audio-stem>-phase1-events.json`        |
| Phase 1 confirmed full PNG   | `<audio-stem>-phase1-confirmed-full.png` |
| Phase 2 segment PNG          | `<audio-stem>-phase2-segment-NN.png`     |
| Phase 2 manifest JSON        | `<audio-stem>-phase2-manifest.json`      |
| Phase 2 zoom PNG             | `<audio-stem>-phase2-segment-NN-zoom-MM.png` |
| Phase 2 events JSON          | `<audio-stem>-phase2-events.json`        |
| Phase 2 confirmed full PNG   | `<audio-stem>-phase2-confirmed-full.png` |

Forbidden name fragments (examples, not exhaustive): `drop`, `breakdown`, `kick-off`, `buildup`, `scout`, `broad`, `q1`/`q2`/`q3`/`q4`, `hq`, `big`, `v1`/`v2`, `phase1-full`, `phase2-full`, range-encoding strings like `100to160`, any adjective describing what's inside the waveform. The initial unmarked full PNG has no phase tag; the phase1/phase2 versions of the full graph only exist as `confirmed-full` after lines are placed.

Events JSON schema (required; `plot-pioneer.py`'s event loader depends on exactly these keys):
- Phase 1 events JSON:
    `{ "source_audio": "<AUDIO_PATH>", "phase1_events_sec": [t1, t2, ...] }`
- Phase 2 events JSON (contains the merged Phase 1 + Phase 2 list, ordered ascending):
    `{ "source_audio": "<AUDIO_PATH>", "phase2_events_sec": [t1, t2, ...] }`

Phase 1:
1. YOU AS THE MAIN AGENT review the full png graph visually and identify major event points in the track. You should aim for no less than 2 and no more than 5 for this phase.
2. Mark provisional lines for the candidate major moments/events.. MAKE SURE THEY ARE PRECISE.
3. THEN FOR EACH PROVISIONAL MAJOR MOMENT/EVENT, create a separate zoomed image around that region following the Filenames section above.
4. THEN HAVE A FRESH SUBAGENT FOR EACH IDENTIFIED MOMENT, and give it ONLY THE RESPECTIVE ZOOMED IMAGE AROUND THE REGION.
5. The subagent must study ONLY THEIR IMAGE and IDENTIFY AND CONFIRM ON VISUAL INSPECTION THE EVENT, AND ENSURE EXACTNESS OF THE TIMING LOOKING OFF THE IMAGE.
6. Then go back to the full graph and place the confirmed Phase 1 lines exactly.
7. THEN LABEL THE NEW PNG WITH CONFIRMED PHASE 1 USING THE AUDIO FILE NAME, for example `<audio-stem>-phase1-confirmed-full.png`.
8. In production, move on to Phase 2 after Phase 1 confirmation.
9. Only stop and show the Phase 1 result if explicitly running in test mode.

Phase 2:
1. Take the existing full mirrored waveform PNG that already has the confirmed Phase 1 lines on it.
2. Do not replot the waveform for slicing.
3. Detect the visible vertical line columns in the PNG itself.
4. Crop the PNG into separate images using the pixel columns between those lines.
5. Exclude the line columns from the crops.
6. Keep the inherited timeline markers visible in the slices.
7. Do not draw any new lines on the slices.
8. Output one raw PNG per segment following the Filenames section above.
9. Output a manifest mapping slice filenames to their source boundaries.
10. YOU AS THE MAIN AGENT review each raw segment image visually and identify candidate additional major moments inside that segment. A segment may have zero to four internal candidates (hard cap: 4 per segment). Do not create false events where no clear standout change point exists. Zero additional events total across the whole Phase 2 review is an acceptable outcome.
11. Mark provisional lines for those candidate internal moments. MAKE SURE THEY ARE PRECISE.
12. THEN FOR EACH PROVISIONAL INTERNAL MOMENT, create a separate tighter zoom around that region following the Filenames section above.
13. THEN HAVE A FRESH SUBAGENT FOR EACH IDENTIFIED MOMENT, and give it ONLY THE RESPECTIVE TIGHTER ZOOMED IMAGE AROUND THE REGION.
14. The subagent must study ONLY THEIR IMAGE and IDENTIFY AND CONFIRM ON VISUAL INSPECTION THE EVENT, AND ENSURE EXACTNESS OF THE TIMING LOOKING OFF THE IMAGE.
15. Then return to the full graph and place those additional lines exactly.
16. THEN LABEL THE NEW PNG WITH CONFIRMED PHASE 2 USING THE AUDIO FILE NAME, for example `<audio-stem>-phase2-confirmed-full.png`.

Output requirements:
- After Phase 1, output the full mirrored graph with confirmed Phase 1 lines using the audio file name, for example `<audio-stem>-phase1-confirmed-full.png`, and the flat ordered list of confirmed Phase 1 timestamps.
- After Phase 2, output the updated full graph with all confirmed lines using the audio file name, for example `<audio-stem>-phase2-confirmed-full.png`, and the final flat ordered list of all confirmed timestamps.

Subagent review rule:
- The subagent studies ONLY its respective zoomed image and returns the confirmed event with its exact timing read off the image. If the zoom genuinely shows no standout event, the subagent may return "no event in zoom" instead — narrow fallback only, not the default.
```
