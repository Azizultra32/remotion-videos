---
name: motion-designer
description: Use when planning a new video composition — produces a scene-by-scene spec with timing, audio cues, SFX, and transitions BEFORE writing any Remotion code
metadata:
  tags: spec, storyboard, planning, scenes, timing, design, motion, video, audio-cue
---

# Motion Designer — Spec Before Code

## Overview

Write the spec first. The composition implements the spec. Skipping this step produces ad-hoc compositions that never converge on the user's vision and silently break the determinism guarantee (renders that drift between sessions because nobody wrote down what "right" looks like).

This is the SPEC phase. **REQUIRED FOLLOW-UP:** Use `music-video-creator` skill for the implementation phase once the spec is signed off.

## When to Use

- Before any new composition file in `src/compositions/`
- Before extending an existing composition with new scenes/elements
- Before any render the user wants to keep (because the spec becomes the diff target for revisions)

**Skip when:** trivial prop tweak to an existing composition, single-frame still preview.

## The Spec Template

Every spec is a markdown file under `docs/specs/<slug>.md`. Fill out every field — empty fields mean undecided, and undecided fields become render bugs.

```markdown
# <Composition Name> — Spec

**Duration:** 30s @ 30fps = 900 frames
**Audio:** public/audio/<slug>.mp3 (BPM: 123, drops: [12.4s, 24.8s])
**Resolution:** 1920x1080 (or 1080x1920 / 1080x1080)
**Brand:** brands/<name>/brand-config.json

## Scenes
| # | Frames | Audio Cue | Visual | Transition Out |
|---|--------|-----------|--------|----------------|
| 1 | 0–180 (0–6s) | Intro pad | Logo fade-in, bell-curve glow peaking at f90 | Cross-dissolve 30f |
| 2 | 180–360 (6–12s) | Build | Title cascade (per-letter spring stagger) | Cut on drop |
| 3 | 360–540 (12–18s) | DROP at f372 | Bass-reactive AHURA halo + zoom-back from 1.4→1.0 over 60f | Hard cut |
| 4 | 540–900 (18–30s) | Outro | Logo + CTA ticker | Fade to black 30f |

## Element Hooks (props the composition will accept)
- `audioPath: string`
- `dropTimestamps: number[]`  // seconds
- `accentColor: string`
- `ctaText: string`

## SFX (non-audio)
- Glitch on f368–f372 (4-frame RGB-channel split, deterministic via random seed)
- Camera shake on drop: 8-frame decay envelope

## Open Questions
(Items needing user sign-off before implementation)
```

## Spec Checklist

Before handing the spec to the implementation skill:

- [ ] Audio file exists and analysis JSON (`*-beats.json`) is generated
- [ ] Duration in frames = duration_seconds × fps (calculated, not guessed)
- [ ] Every scene boundary lands on a beat OR has an explicit reason it doesn't
- [ ] Every drop in the audio has at least one visual reaction
- [ ] Prop schema drafted with Zod-friendly types
- [ ] Brand colors mapped from `brand-config.json`, not hardcoded
- [ ] Render target known (1080p / 1080x1920 / 1080x1080)
- [ ] Open Questions section is empty (or user has answered each)

## Common Mistakes

| Mistake | Why it bites |
|---|---|
| Skipping spec → "just start coding" | Composition diverges from intent on every revision; no diff target |
| Spec without audio analysis | Scene timings are guesses; cuts land off-beat |
| Duration in seconds, not frames | `<Sequence from={N}>` takes frames; mental conversion errors compound |
| Hardcoded colors | Brand swap requires touching every scene file |
| No Open Questions section | Implementation agent invents answers and confabulates user intent |

## Cross-References

- **REQUIRED FOLLOW-UP:** `music-video-creator` — implementation phase for music-driven specs
- `explainer-video-guide` — narration-driven pipeline (script → VO → captions)
- `awwwards-animations` — pattern library for SFX entries in the spec
