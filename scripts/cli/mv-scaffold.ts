#!/usr/bin/env tsx
// scripts/cli/mv-scaffold.ts
//
// Bootstraps a new project from an audio file anywhere on disk. Creates
// projects/<stem>/ with the audio copied in, an analysis/ subfolder, and
// a starter timeline.json. Git-LFS picks up the audio on next `git add`.
//
// Usage:
//   npm run mv:scaffold -- --audio /Volumes/External/tracks/my-song.mp3
//   npm run mv:scaffold -- --audio ./incoming.mp3 --stem custom-name
//
// Suggests next steps at the end (run mv:analyze, pick the track in editor).
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { ensureProjectsDir, resolveProjectDir } from "./paths";

const repoRoot = resolve(__dirname, "..", "..");

type Args = { audio?: string; stem?: string };

const parseArgs = (): Args => {
  const a: Args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const tok = process.argv[i];
    const next = process.argv[i + 1];
    if (tok === "--audio" && next) {
      a.audio = next;
      i++;
    } else if (tok === "--stem" && next) {
      a.stem = next;
      i++;
    }
  }
  return a;
};

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\.[^.]+$/, "") // drop extension
    .replace(/[^a-z0-9]+/g, "-") // non-alphanum -> hyphen
    .replace(/^-+|-+$/g, "") // trim leading/trailing hyphens
    .slice(0, 60) || "track";

const args = parseArgs();
if (!args.audio) {
  console.error("usage: mv:scaffold --audio <path/to/audio.mp3> [--stem <name>]");
  process.exit(1);
}

const audioSource = resolve(args.audio);
if (!existsSync(audioSource)) {
  console.error(`audio file not found: ${audioSource}`);
  process.exit(1);
}

const ext = extname(audioSource).toLowerCase();
if (![".mp3", ".wav", ".m4a"].includes(ext)) {
  console.error(`unsupported audio format: ${ext} (expected .mp3/.wav/.m4a)`);
  process.exit(1);
}

const stem = args.stem ? slugify(args.stem) : slugify(basename(audioSource));
ensureProjectsDir(repoRoot);
const projectDir = resolveProjectDir(repoRoot, stem);
if (existsSync(projectDir)) {
  console.error(`project already exists: projects/${stem}/`);
  console.error(`pick a different --stem or remove the existing folder first`);
  process.exit(1);
}

const audioExt = ext === ".wav" ? ".wav" : ".mp3"; // normalize m4a to mp3 container name (file bytes unchanged)
const audioDest = resolve(projectDir, `audio${audioExt}`);
const analysisDir = resolve(projectDir, "analysis");
const customElementsDir = resolve(projectDir, "custom-elements");
const timelinePath = resolve(projectDir, "timeline.json");

mkdirSync(analysisDir, { recursive: true });
mkdirSync(customElementsDir, { recursive: true });
copyFileSync(audioSource, audioDest);

const starterTimeline = {
  version: 1,
  stem,
  fps: 24,
  compositionDuration: 90,
  elements: [],
};
writeFileSync(timelinePath, `${JSON.stringify(starterTimeline, null, 2)}\n`);

// Seed the per-project custom-elements/ dir with a ready-to-activate example.
// Writing as `.tsx.example` so the renderer's barrel scan (filters `*.tsx`)
// ignores it until the author renames the file. Import path uses the
// `@engine/*` alias (configured in remotion.config.ts + editor/vite.config.ts
// + tsconfig.json) so the template works regardless of where MV_PROJECTS_DIR
// points — even external volumes or differently-named engine clones.
const exampleModuleName = "ExampleElement";
const exampleModuleId = `custom.${stem.replace(/[^a-zA-Z0-9]/g, "")}.example`;
const examplePath = resolve(customElementsDir, `${exampleModuleName}.tsx.example`);
const exampleBody = `// Per-project custom element — drop this file (renamed to .tsx) to activate.
//
// Rename to ${exampleModuleName}.tsx, tweak the renderer, and run:
//   npm run mv:render -- --project ${stem}
// The renderer's barrel generator picks up every *.tsx in this folder.
//
// Contract: default-export an ElementModule<P> whose id is unique across the
// active registry (engine built-ins + other files in this folder). Same id as
// an engine built-in OVERRIDES the engine entry for this project — intentional.

import type React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import type { ElementModule, ElementRendererProps } from "@engine/types";

const schema = z.object({
  text: z.string(),
  color: z.string(),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  text: "${stem}",
  color: "#ffffff",
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localSec = frame / fps;
  const opacity = interpolate(localSec, [0, 0.4], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          fontSize: Math.min(ctx.width, ctx.height) * 0.12,
          fontWeight: 900,
          color: element.props.color,
          opacity,
          letterSpacing: "0.02em",
        }}
      >
        {element.props.text}
      </div>
    </AbsoluteFill>
  );
};

const ${exampleModuleName}Module: ElementModule<Props> = {
  id: "${exampleModuleId}",
  category: "text",
  label: "${exampleModuleName} (${stem})",
  description: "Starter custom element for ${stem}. Edit freely — lives outside the engine.",
  defaultDurationSec: 4,
  defaultTrack: 2,
  schema,
  defaults,
  Renderer,
};

export default ${exampleModuleName}Module;
`;
writeFileSync(examplePath, exampleBody);

console.log(`scaffolded projects/${stem}/`);
console.log(`  audio:          projects/${stem}/audio${audioExt} (copy of ${audioSource})`);
console.log(`  timeline:       projects/${stem}/timeline.json (empty)`);
console.log(`  analysis:       projects/${stem}/analysis/ (empty, awaiting mv:analyze)`);
console.log(`  custom-elements: projects/${stem}/custom-elements/${exampleModuleName}.tsx.example`);
console.log("");
console.log("next steps:");
console.log(`  1. npm run mv:analyze -- --project ${stem}     # Setup + analyze for event points`);
console.log(`  2. Open editor (npm run dev in editor/), pick "${stem}" in the SongPicker`);
console.log(
  `  3. Rename custom-elements/${exampleModuleName}.tsx.example → .tsx to activate your first custom element`,
);
console.log(
  `  4. (Project content is gitignored by design. If you want history, point MV_PROJECTS_DIR at a separate git repo and commit there.)`,
);
