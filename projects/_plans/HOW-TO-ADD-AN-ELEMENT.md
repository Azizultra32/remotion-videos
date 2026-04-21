# How to add a new visual element

**Short version:** Drop a `.tsx` file under `projects/<stem>/custom-elements/` that default-exports an `ElementModule<P>`. Restart the editor (or switch to this project). Reference it by its `id` from `timeline.json`. Engine never grows.

---

## The contract

Every element is an `ElementModule<P>` (see `src/compositions/elements/types.ts`):

```ts
export type ElementModule<P> = {
  id: string;                        // globally unique, e.g. "custom.dubfire.ahuraZoom"
  category: "text" | "audio" | "shape" | "overlay" | "video";
  label: string;                     // sidebar display
  description: string;               // tooltip / docs
  defaultDurationSec: number;
  defaultTrack: number;
  schema: z.ZodType<P>;              // zod schema for props
  defaults: P;                       // default prop values
  Renderer: FC<ElementRendererProps<P>>;
  Controls?: FC<ElementControlsProps<P>>;   // optional editor-side controls
};
```

The `Renderer` receives `{ element, ctx }` where `element.props` is typed as `P` and `ctx` carries frame, fps, dimensions, audio source, beats API, and named events. Use Remotion's `useCurrentFrame`, `useVideoConfig`, `interpolate`, `<AbsoluteFill>`, `<Img>`, `<Audio>`, etc.

## The fast path

```bash
# scaffold seeds a template for you
npm run mv:scaffold -- --audio /path/to/track.mp3 --stem my-song
# → creates projects/my-song/custom-elements/ExampleElement.tsx.example

# activate the template
mv projects/my-song/custom-elements/ExampleElement.tsx{.example,}

# editor's Vite plugin auto-reloads on file add — no restart needed
# add to timeline via the sidebar, or write into timeline.json manually:
#   { "type": "custom.mysong.example", "id": "...", "startSec": 0, ... }

# render
npm run mv:render -- --project my-song
```

## Where does it live?

| Path | When |
|------|------|
| `projects/<stem>/custom-elements/<Name>.tsx` | Per-track creative work. **99% of the time, here.** Not tracked in git (gitignored with the rest of `projects/<stem>/`). |
| `src/compositions/elements/<category>/<Name>.tsx` | Engine built-in. Requires `ENGINE_UNLOCK=1` + register in `src/compositions/elements/registry.ts`. Only justified when the element is generic, reusable across arbitrary projects, and not just one track's creative vocabulary. |

**If you find yourself asking "should this be an engine element?" the answer is almost always no.** BellCurveReveal, ZoomReveal, and similar were engine elements for one specific song — that's the anti-pattern this structure exists to prevent.

## How the wiring works

1. **Renderer side** (`scripts/cli/mv-render.ts`): before spawning Remotion, calls `generateCustomElementsBarrel(repoRoot, projectDir)` which writes `src/compositions/elements/_generated-custom-elements.ts` with imports of every `.tsx` in the active project's `custom-elements/`. `src/compositions/elements/registry.ts` imports this barrel and concatenates with the engine built-ins. The barrel is reset to empty on process exit.
2. **Editor side** (`editor/vite-plugin-custom-elements.ts`): Vite plugin intercepts `load()` for the same barrel path and serves a virtual module whose contents are scanned from the active project. Watches `.current-project` + `<projectDir>/custom-elements/`; triggers a full reload on any change. Nothing gets written to `src/**`.
3. **ID collisions win later**: if a project element and an engine element share the same `id`, the project wins. Intentional — a track can retune a primitive without forking the engine.
4. **Failure isolation**: `src/compositions/MusicVideo.tsx` wraps each Renderer in `<SafeElement>` (React ErrorBoundary). A broken custom element logs a warning and renders nothing — it can't take down the full composition.

## Import path for engine types

Custom elements import engine types via the `@engine/*` alias:

```ts
import type { ElementModule, ElementRendererProps } from "@engine/types";
```

The alias is wired in three places — keep it consistent if you ever add a new pipeline:
- `remotion.config.ts` — Webpack `resolve.alias` for renderer bundles
- `editor/vite.config.ts` — Vite `resolve.alias` for the editor preview
- `tsconfig.json` `compilerOptions.paths` — TypeScript IDE intellisense

The alias resolves to `src/compositions/elements/`. So `@engine/types` → `src/compositions/elements/types.ts`, `@engine/overlays/StaticImage` → that file, etc.

Why an alias instead of a relative path: custom elements can live anywhere `MV_PROJECTS_DIR` points (external volumes, separate repos). A relative path baked at scaffold time would break the moment the project moves to a different machine. The alias is portable.

## Common pitfalls

- **No default export** → barrel generator can't import. Template uses `export default`; stick with it.
- **`id` collision with engine element you didn't mean to override** → pick a project-specific prefix like `custom.<stem>.<name>`.
- **Schema validation failing** → project schema uses a different Zod instance than the engine. Editor deduplicates zod (`vite.config.ts` `dedupe: ["zod"]`); renderer uses the single bundled copy. If you've pinned zod to a different version in the project, don't.
- **Editor doesn't see new files** → the plugin watches the active project's `custom-elements/` dir, but only after `.current-project` resolves. Set a project first (`mv:switch`), then add elements.
- **Renderer can't find element type** → check that `id` in the element module matches the `type` in `timeline.json`.

## When to promote to engine

Move an element from `projects/<stem>/custom-elements/` to `src/compositions/elements/<category>/` only when:

- Two or more tracks already use it (not "might use" — *actually* use).
- It has no project-specific vocabulary baked into defaults.
- The maintenance cost of engine-grade test coverage + docs is less than the cost of duplicating across projects.

In the 80% case, leave it where it is. The engine is not a kitchen sink.
