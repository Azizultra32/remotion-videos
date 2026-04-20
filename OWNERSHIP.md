# Ownership Rules

Canonical write-access rules for this repo. Enforced at two layers:

1. **Claude Code hook** — `.claude/settings.json` `PreToolUse` runs `scripts/check-ownership.sh` before every `Write` / `Edit`. If the target is in an engine path and `ENGINE_UNLOCK=1` is not set in the shell env, the write is blocked.
2. **Git pre-commit hook** — *(future)* rejects commits that mix engine + project paths or touch engine paths without the same env var.

Agents must obey this file. Humans can override locally (`ENGINE_UNLOCK=1 <command>`), but should only do so for deliberate engine changes.

---

## Engine (LOCKED for writes — read + execute always allowed)

These paths hold reusable infrastructure: the render engine, the editor app, the analysis pipeline, and the contract docs themselves. Agents **cannot** modify them unless the user unlocks.

```
src/hooks/                     Remotion hooks (locked)
src/utils/                     shared util modules (locked)
src/lib/                       library modules (locked)
src/components/                Remotion UI components (locked)
src/Root.tsx                   composition registration (locked)
src/compositions/**            element authoring library (FREE-WRITE — no ENGINE_UNLOCK required)
editor/                        Vite editor app (UI + sidecar plugin)
scripts/                       All Python + shell + TypeScript scripts
public/fonts/                  engine-level assets
public/tokens/                 design tokens (if any)
public/projects (symlink)      required by Remotion staticFile — do not delete
.claude/                       Claude Code hooks + project-scoped skills
docs/                          documentation (including master prompt)
package.json, tsconfig.json    build config
.gitignore, .gitattributes     git config
CLAUDE.md                      project-wide agent instructions
ENGINE.md                      engine path enumeration
OWNERSHIP.md                   this file
README.md                      top-level readme
remotion.config.ts             Remotion config
```

## Free (agents write freely)

```
projects/<stem>/               per-track content (gitignored; user local)
projects/<stem>/custom-elements/  per-project React element modules (*.tsx) — the creative freezone
projects/_plans/               shared design docs + implementation plans (TRACKED)
brands/                        per-brand workspaces (tracked)
out/                           rendered MP4s (gitignored)
.current-project               active-project marker (gitignored)
```

Project data lives where `MV_PROJECTS_DIR` points, defaulting to `<engineRoot>/projects/`. The entire `projects/<stem>/` tree is gitignored — audio, analysis, timeline, PNGs, everything. The only exception is `projects/_plans/` which holds engine-level design docs shared across the codebase.

**`custom-elements/` is the designated home for new creative visuals.** The renderer (`scripts/cli/mv-render.ts`) and the editor (`editor/vite-plugin-custom-elements.ts`) both scan this directory and surface its modules to the composition's element registry. Adding a new effect here does NOT require an engine commit and does NOT need `ENGINE_UNLOCK=1`. See `CLAUDE.md` for the authoring contract.

## Forbidden (gitignored — never commit)

```
node_modules/                  npm deps
editor/dist/                   editor build output
.venv-allin1/                  Python venv
scripts/__pycache__/           Python bytecode
*.tsbuildinfo                  tsc incremental cache
.DS_Store                      macOS Finder metadata
projects/*/                    per-track project data (see Free above)
vendor/                        reference clones of other people's work
.claude/settings.local.json    per-machine Claude Code settings
.claude/scheduled_tasks.lock   transient lock
```

---

## Unlock procedure

When the user wants an agent to modify engine code, they set the env var in their shell before invoking Claude Code:

```bash
ENGINE_UNLOCK=1 claude
```

The env var propagates to Claude Code's subprocess, which propagates to the `PreToolUse` hook subprocess. Agents cannot self-unlock because the Bash tool's env doesn't leak into hook subprocesses — the hook sees only the parent's env.

For one-off edits without re-launching Claude Code: the user can export the var in the current terminal:

```bash
export ENGINE_UNLOCK=1
# agent may now modify engine paths for the rest of this terminal session
```

## When in doubt

If you're an agent and unsure whether a path is engine:

1. Check this file's tables above.
2. If the path is not explicitly listed as Free, treat it as engine.
3. Ask the user before proceeding.

The cost of pausing is low; the cost of an accidental engine change is a reverted commit plus context rebuild.
