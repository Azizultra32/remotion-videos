# remotion-videos

Reusable **engine** for beat-matched programmatic music videos. Clone, `npm install`, `npm run dev`, and you have the browser-based timeline editor + the analysis pipeline + the render CLI. Project data (audio, analysis, timelines) lives **outside** the engine repo and is created locally per track.

## Quick start

```bash
git clone https://github.com/Azizultra32/remotion-videos.git
cd remotion-videos
npm install
cd editor && npm install && cd ..    # editor has its own package.json
cd editor && npm run dev              # browser editor at http://localhost:4000/
```

First run lands you on the empty-project state. Create a track:

```bash
npm run mv:scaffold -- --audio /absolute/path/to/song.mp3
npm run mv:analyze  -- --project <stem>     # 5-10 min, runs full pipeline
```

…or drop the mp3 onto the **+ New** button in the editor — same effect, no terminal.

## Where projects live

By default, projects go under `<engineRoot>/projects/<stem>/` (gitignored). You can relocate them:

```bash
export MV_PROJECTS_DIR="$HOME/mv-projects"
npm run dev                          # sidecar now reads projects from ~/mv-projects
npm run mv:scaffold -- --audio ...   # new tracks go there too
```

The engine automatically:
- Creates `MV_PROJECTS_DIR` if missing on first access
- Keeps `public/projects` symlinked at the resolved directory so Remotion renders still work
- Keeps an engine-local symlink portable (relative `../projects`) when unset, per-machine absolute when overridden

## Repo structure

```
editor/              Vite + React timeline editor (browser UI + node sidecar)
src/                 Remotion compositions + hooks
scripts/             Analysis pipeline (Python) + CLI (TypeScript) + shell glue
  cli/paths.ts       Single source of truth for "where do projects live"
  cli/mv-*.ts        Headless entry points (scaffold, analyze, render, etc.)
  *.py               Python audio analysis (energy bands, beat detection, plots)
public/              Remotion static assets (fonts, tokens, projects symlink)
docs/                Design specs + protocol docs (engine-level)
.claude/             Agent instructions (CLAUDE.md loads automatically)
  skills/            Skill bundles for Claude Code sessions
projects/            Per-track content — gitignored (except _plans/)
  _plans/            Shared design docs + implementation plans (tracked)
```

## Engine vs project data

- **Engine** (this repo): editor code, render pipeline, CLI scripts, analysis Python, agent skills. What you `git clone`.
- **Projects**: audio files, analysis output, timeline state, per-track notes. What you create locally.

The engine is track-agnostic. Everything under `projects/<stem>/` follows the same convention — `audio.mp3`, `analysis.json`, `timeline.json`, `analysis/` artifact directory. Any track works with any composition; any project directory works with any engine clone.

## For Claude Code / AI agents

`CLAUDE.md` at the repo root + `.claude/skills/` are auto-loaded. Key commands:

```bash
npm run mv:current        # print active project stem
npm run mv:switch -- --project <stem>
npm run mv:seed-beats -- --project <stem>     # beats-only, ~45s
npm run mv:analyze  -- --project <stem>       # full pipeline, ~5-10 min
npm run mv:clear-events -- --project <stem>   # wipe Phase 1 + Phase 2 events
npm run mv:render   -- --project <stem>       # render MP4
```

Engine paths (`editor/**`, `src/**`, `scripts/**`, `.claude/**`, `docs/**`, top-level config + docs) are write-locked behind `ENGINE_UNLOCK=1`; see `OWNERSHIP.md`.

## License & determinism

Renders are byte-identical for a given `(code, props, assets)` tuple. That's load-bearing for the versioning story: a tagged render always reproduces. Don't use `Math.random()` inside Remotion compositions — use Remotion's seeded `random("seed")` instead. See `CLAUDE.md` rule #1.
