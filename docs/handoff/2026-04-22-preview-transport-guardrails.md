# Preview Transport Guardrails

This note exists to keep future playback work out of the same loop.

## Root Cause

The editor preview uses two independent playback clocks:

- Remotion `Player` for visuals
- a standalone HTML `<audio>` element for audio

The bug was caused by feeding `Player.frameupdate` back into store time and
then treating all store-time changes as generic "seek" requests. That turned
visual hitches into hard audio seeks, which sounded like choppy playback.

## What Landed

- `editor/src/components/Preview.tsx`
  - ignores only store updates known to come from its own `Player.frameupdate`
  - keeps explicit seek/jump reconciliation
  - only hard-seeks audio on paused scrubs or obvious large jumps
- `editor/src/components/FloatingPreview.tsx`
  - mirrors real store seeks again
  - does not use the over-broad passive-update heuristic
- `editor/src/utils/previewTransport.ts`
  - contains only the audio hard-seek rule, not a generic playback-delta filter

## What Not To Reintroduce

Do not add a generic rule like:

- "ignore any positive `currentTimeSec` delta under N frames while playing"

That looked reasonable, but it broke:

- 1-frame keyboard nudges during playback
- small explicit timeline seeks while still playing
- floating preview mirroring

The correct distinction is source-aware:

- ignore updates that are known to originate from the main preview's own
  `Player.frameupdate`
- do not ignore store updates just because they are small

## Residual Risk

`BeatVideoCycle` now behaves correctly again, but it still remounts
`OffthreadVideo` on qualifying triggers. If playback still feels uneven after
the transport fix, the next suspect is render/decode cost in the beat-triggered
video path, not transport semantics.
