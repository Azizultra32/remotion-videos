# Remotion Video Production — Claude Brain

## Project Overview
This is a Remotion project for programmatic video creation. You (Claude) are the video engineer.
Create videos by writing React components that render frame-by-frame.

## Core Rules
1. **Determinism**: NEVER use `Math.random()`. Use `random('seed')` from Remotion instead.
2. **Exact versions**: All `@remotion/*` packages must be the same version (currently 4.0.434).
3. **Component export**: Video components must be default or named exports from `src/compositions/`.
4. **Register compositions** in `src/Root.tsx` using `<Composition>`.
5. **Static assets** go in `public/` and are referenced with `staticFile()`.

## Parallel Agent Coordination
If you suspect another Claude Code / coding-agent session is running on this
repo, claim files before editing:

```bash
scripts/agents.py claim <your-id> <file>...   # grab
scripts/agents.py status                       # see everyone's claims
scripts/agents.py release <your-id>            # let go when done
```

A `PreToolUse` hook in `.claude/settings.json` auto-claims on every Edit/Write
using the session id, so in practice you rarely need to call `claim` manually
— but `status` before starting work is still a good sanity check. Full docs:
`docs/AGENT-COORDINATION.md`.

## Git Hygiene (tied to Remotion's determinism guarantee)

Remotion renders are byte-identical for the same `(code, props, assets)`
tuple. That guarantee is only useful if you can recover the exact input later,
which means git discipline is part of the workflow, not optional.

1. **Commit before every render you want to reference.** If an exported MP4
   corresponds to no commit, you can't bisect "when did the drop sync break?"
   Rule: no final render from a dirty tree.
2. **Tag released renders.** When you export an MP4 for DaVinci, run:
   `git tag render-<project>-<version>` (e.g. `render-dubfire-v3`).
   Tags are the map from final-file → source code.
3. **Props/state in git, not the editor alone.** The editor saves state to
   `edits.json` / `project.json`; commit those with the code that consumes
   them. "That version I liked yesterday" stays recoverable.
4. **Stage narrowly — verify before committing.** When multiple agents are
   live (see above), prefer `git add <specific-file>` over `git add -A/.`,
   and always run `git diff --cached --stat` before `git commit` so you know
   exactly what's in the commit. Another agent's pre-staged files WILL be
   swept up otherwise.
5. **Media stays out of git.** Raw video/audio (MP4/WAV > 10MB) belongs in
   `~/media-raw/` or external storage, referenced by absolute path from
   `project.json`. Git tracks code + small analysis JSON + stills + edit
   state; not source media.

## Project Structure
```
src/
  index.ts          → registerRoot() entry point
  Root.tsx          → All <Composition> registrations (18 compositions)
  compositions/     → Video component files
  components/       → Reusable UI components
public/             → Static assets (images, fonts, audio)
brands/             → Brand workspace folders (one per client/brand)
  <brand-name>/
    brand-config.json  → Colors, typography, taglines
    logos/             → Logo files
    photos/            → Product photos, team photos
    fonts/             → Custom fonts
    colors/            → Color palette exports
scripts/             → Render helper scripts
  render-all.sh       → Batch render all compositions
  render-brand.sh     → Render branded videos from brand-config.json
  preview-frame.sh    → Quick single-frame preview
  render-programmatic.ts → TypeScript batch renderer using @remotion/renderer API
docs/                → Advanced patterns reference
  ADVANCED-PATTERNS.md → Three.js, Lottie, Captions, Charts, Studio, CI, Prompts
out/                 → Rendered output (gitignored)
.claude/
  settings.json      → MCP server config (@remotion/mcp)
  skills/            → 38 Remotion agent skill files
```

## Key Commands
- `npm run dev` → Start Remotion Studio (live preview at localhost:3000)
- `npx remotion render src/index.ts <CompositionId> out/<name>.mp4` → Render video
- `npx remotion still src/index.ts <CompositionId> out/<name>.png` → Render single frame
- `npx remotion compositions src/index.ts` → List all compositions
- `bash scripts/render-all.sh` → Render all compositions at once
- `bash scripts/render-brand.sh <brand-folder>` → Render branded video from config
- `bash scripts/preview-frame.sh <CompositionId> [frame]` → Quick still preview

## Animation Patterns
- `useCurrentFrame()` — current frame number (0-indexed)
- `useVideoConfig()` — { width, height, fps, durationInFrames }
- `interpolate(frame, inputRange, outputRange, options)` — map values
- `spring({ frame, fps, config })` — physics-based animation
- `<Sequence from={N}>` — time-shift content to start at frame N
- `<Series>` — sequential playback (used in VideoStitcher)
- `<AbsoluteFill>` — full-canvas layer

## Compositions (18 registered)

### Core / Demo
- **TextOverlay** — Animated text with spring physics (5s, 30fps). Props: title, subtitle, backgroundColor, textColor, accentColor
- **ProductDemo** — Parameterized product demo (10s, 30fps). Props: productName, tagline, features[], ctaText, colors

### MMX Pipeline
- **MMXPipelineReport** — 8-stage pipeline run visualization (15s, 30fps). Props: stages[], runId, targetRepo, totalCost

### Brand System
- **BrandedDemo** — Brand-aware 3-section narrative (13.5s, 30fps). Props: brandName, brandConfig, features[], ctaText, showLogo. Reads from brands/<name>/brand-config.json
- **LogoReveal** — Animated logo reveal with customizable effects. Props: logoPath, backgroundColor, revealType, durationInFrames

### Video Production
- **VideoStitcher** — Scene-chaining composition (16s, 30fps). Props: scenes[] with type (title/feature/cta/transition), title, content, durationInFrames, colors. Uses `<Series>` for sequential playback with lower-third progress indicator.
- **AdCreative** — Ecom/agency ad (15s, 30fps, 1920x1080). Props: productName, productImage, price, features[], ctaText, colors, orientation. 4 phases: product reveal → feature highlights → price tag → CTA.
- **AdCreativeVertical** — Same as AdCreative but 1080x1920 for stories/reels.
- **CaptionedVideo** — Video with animated captions overlay. Props: videoPath, captions[], styling options
- **VideoWithTitle** — Simple video with title overlay. Props: videoPath, title, styling (848x480, 24fps)
- **PublicCut** — Video cut/trim composition. Props: videoPath, startTime, endTime (848x480, 24fps)
- **BeatDrop** — Music-synced visual effects on beat drops. Props: audioPath, beatTimestamps[], visualStyle (848x480, 24fps)

### Marketing / Social
- **MapAnimation** — SVG world map with animated network connections (10s, 30fps). Props: locations[] (name, x, y, color), connectionSpeed, backgroundColor. Bezier paths, traveling particles, pulsing dots.
- **ExplainerVideo** — Multi-scene motion explainer with slide transitions (12s, 30fps). Props: scenes[] (title, description, iconEmoji, backgroundColor). Progress bar, scene counter.
- **SocialProof** — Testimonial showcase with typewriter quote reveal (12s, 30fps). Props: testimonials[] (quote, author, role, rating), accentColor. Star ratings, indicator dots.
- **CountdownTimer** — Animated countdown with customizable styling. Props: targetDate, title, backgroundColor
- **TIDExplainer** — 7-scene Terminal Identity System explainer video. Props: scenes[], styling, branding
- **IranUpdate** — News update composition with dynamic content. Props: headline, content, sources[], timestamp

## MMX Visualization Guidelines
When creating MMX-related videos:
- Use the 8-stage pipeline: PRE-FLIGHT → CATHEDRAL → FIND → DISTILL → PREDICT → PROPOSE → IMPLEMENT → FINAL GUARD
- Color code: green=passed, red=failed, yellow=running, gray=pending
- Stage data comes from `.metamatrix/state.json` in the target repo
- Keep animations clean and professional — this is for analysis, not entertainment

## Brand Workspace Pattern
Each brand gets a folder in `brands/`:
```
brands/acme-corp/
  brand-config.json    → { name, tagline, colors: {primary, secondary, accent, background, text}, typography: {heading, body}, social: {website, twitter} }
  logos/               → SVG/PNG logo files
  photos/              → Product/team photos
  fonts/               → Custom .woff2/.ttf fonts
  colors/              → Color palette exports
```
To create a branded video: load brand-config.json → pass as `brandConfig` prop to BrandedDemo or any composition.

## Editor (`editor/`) — Current Limitations

The timeline editor at `editor/` is wired to the **PublicCut** composition only. Current state:

**Fully wired** (Sidebar presets that update the preview):
- None yet. The Sidebar's 4 presets (Text Block, Image, Effect, Beat Flash) are
  marked `(not wired yet)` — they add elements to the timeline, but the preview
  does not change because `propsBuilder` has no mapping from these types into
  `PublicCut`'s schema.

**Wired paths that work today:**
- Well-known labels (`AHURA`, `DUBFIRE`, `OMEGA`, `T-MINUS-12:12`) on any
  element map to specific PublicCut props (see `editor/src/utils/propsBuilder.ts`).
- Any element with `props.mapTo: "<publicCutFieldName>"` sets that field to
  `startSec`; `props.mapToDuration` sets it to `durationSec`.

**To wire new element types end-to-end**, either:
1. Extend PublicCut to accept generic overlay props (preferred for keeping
   PublicCut's focused design), OR
2. Create a new composition (`CustomMusicVideo`) that accepts an overlay array
   and repoint `editor/src/components/Preview.tsx` at it, OR
3. Require every Sidebar preset to declare `mapTo` / `mapToDuration`.

Open design questions (for a future plan):
- What does each "effect" (zoom/fade/shake/glow/blur) actually render?
- How should images be positioned/scaled/animated?
- Should text overlays use spring physics by default?

## Skill Stacking (Level 2+)
When I teach you a new skill or give you a new API key:
1. Update THIS file with the new capability
2. Note the service, API endpoint, and usage pattern
3. Apply it in future video creations when relevant

### Available API Integrations (add keys to unlock)
- **WaveSpeed** — AI lip-sync video generation. Upload image + audio → get talking head video.
- **ElevenLabs** — Text-to-speech with cloned voices. Generate voiceovers for video narration.
- **HeyGen** — AI avatar video generation. Create spokesperson videos from text scripts.
- **Nano Banana Pro** — Fast image generation. Create product photos, backgrounds, thumbnails.
- **Whisper.cpp** — Audio transcription for auto-captioning (via @remotion/install-whisper-cpp)

### Workflow: AI-Generated Ad
1. Generate product image (Nano Banana Pro) → save to brands/<name>/photos/
2. Generate voiceover (ElevenLabs) → save to public/audio/
3. Render AdCreative composition with product image + voiceover
4. Optional: Generate talking head (WaveSpeed/HeyGen) → composite with `<Video>` component

## Available Skills
- **Remotion Agent Skills**: 38 skill files in .claude/skills/ covering animations, 3D, charts, transitions, typography, captions, audio, video trimming, and more
- **Advanced Patterns**: See docs/ADVANCED-PATTERNS.md for Three.js, Lottie, Charts, CI/CD, and prompt gallery patterns

## Tips
- Always preview with `npx remotion still` before full renders (much faster)
- Use `extrapolateRight: "clamp"` to prevent values going past their target
- Prefer `spring()` over linear `interpolate()` for natural motion
- Inline styles are the default — no CSS framework is installed
- For scene-based videos, use VideoStitcher — define scenes as an array, it handles timing
- For brand work, always load brand-config.json first
- Render scripts in scripts/ handle batch operations
