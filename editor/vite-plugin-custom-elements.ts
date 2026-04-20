// editor/vite-plugin-custom-elements.ts
//
// Editor-side mirror of scripts/cli/custom-elements-barrel.ts. The renderer
// writes a real _generated-custom-elements.ts file to disk before bundling;
// the editor can't — the barrel's tracked stub is committed as empty, and
// writing to src/** during dev would fight the engine-lock hook and leave
// the working tree dirty.
//
// Instead, this plugin intercepts Vite's load() for the barrel file path
// and substitutes an in-memory module whose contents are computed from
// whatever project is active. Active project = first line of
// `<repoRoot>/.current-project` (written by the editor's SongPicker).
//
// HMR strategy: full-reload on any change to the active project's
// custom-elements/ contents or to .current-project. The registry is built
// once at module init; cascading per-module HMR into MusicVideo's
// ELEMENT_REGISTRY dispatch would require invalidating half the render
// pipeline anyway. A reload is clearer and cheap in dev.
//
// Ownership: this lives under editor/ (outside the engine-lock zone).
// It doesn't mutate any engine file — only intercepts the barrel's load
// request. The real tracked stub on disk stays empty.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ViteDevServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const editorDir = dirname(__filename);
const repoRoot = resolve(editorDir, "..");
const barrelAbsPath = resolve(
  repoRoot,
  "src/compositions/elements/_generated-custom-elements.ts",
);

const resolveActiveStem = (): string | null => {
  const p = resolve(repoRoot, ".current-project");
  try {
    const stem = readFileSync(p, "utf8").trim();
    return stem || null;
  } catch {
    return null;
  }
};

const resolveProjectsDir = (): string => {
  const override = process.env.MV_PROJECTS_DIR?.trim();
  if (override) {
    return override.startsWith("~/")
      ? resolve(process.env.HOME || "", override.slice(2))
      : resolve(override);
  }
  return resolve(repoRoot, "projects");
};

const resolveCustomElementsDir = (stem: string): string =>
  resolve(resolveProjectsDir(), stem, "custom-elements");

const EMPTY_BODY = `// virtual: no active project, empty barrel
import type { ElementModule } from "./types";
export const PROJECT_CUSTOM_ELEMENTS: ElementModule<unknown>[] = [];
`;

const buildBarrelBody = (stem: string | null): string => {
  if (!stem) return EMPTY_BODY;
  const customDir = resolveCustomElementsDir(stem);
  if (!existsSync(customDir)) return EMPTY_BODY;

  const entries = readdirSync(customDir)
    .filter((f) => f.endsWith(".tsx") && !f.startsWith("."))
    .sort();
  if (entries.length === 0) return EMPTY_BODY;

  const barrelDir = dirname(barrelAbsPath);
  const lines: string[] = [
    `// virtual: active project ${stem} → ${entries.length} custom element(s)`,
    `import type { ElementModule } from "./types";`,
  ];
  const imports: string[] = [];
  entries.forEach((file, i) => {
    const stemName = basename(file, extname(file));
    const ident = `_proj_${i}_${stemName.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    imports.push(ident);
    const importPath = relative(barrelDir, resolve(customDir, file))
      .replace(/\\/g, "/")
      .replace(/\.tsx$/, "");
    lines.push(
      `import ${ident} from "${importPath.startsWith(".") ? importPath : `./${importPath}`}";`,
    );
  });
  lines.push(
    "",
    `export const PROJECT_CUSTOM_ELEMENTS: ElementModule<unknown>[] = [`,
    ...imports.map((n) => `  ${n},`),
    "];",
    "",
  );
  return lines.join("\n");
};

export const customElementsPlugin = (): Plugin => {
  let server: ViteDevServer | null = null;
  let watchedStem: string | null = null;

  const reload = (reason: string) => {
    if (!server) return;
    server.config.logger.info(`[mv-custom-elements] ${reason} — full reload`);
    const mod = server.moduleGraph.getModuleById(barrelAbsPath);
    if (mod) server.moduleGraph.invalidateModule(mod);
    server.ws.send({ type: "full-reload", path: "*" });
  };

  const watchActiveProjectDir = () => {
    if (!server) return;
    const stem = resolveActiveStem();
    if (stem === watchedStem) return;
    // Unwatch the prior project's custom-elements/ before adding the new
    // one. Without this, switching projects N times accumulates N stale
    // watchers, each firing a spurious full-reload on any file event in
    // an old project's folder.
    if (watchedStem) {
      const oldDir = resolveCustomElementsDir(watchedStem);
      try {
        server.watcher.unwatch(oldDir);
      } catch {
        // Chokidar throws if the path was never added; safe to ignore.
      }
    }
    watchedStem = stem;
    if (!stem) return;
    const customDir = resolveCustomElementsDir(stem);
    server.watcher.add(customDir);
  };

  return {
    name: "mv-custom-elements",

    configureServer(s) {
      server = s;
      const currentProjectFile = resolve(repoRoot, ".current-project");
      s.watcher.add(currentProjectFile);
      watchActiveProjectDir();

      const onChange = (path: string) => {
        const norm = resolve(path);
        if (norm === currentProjectFile) {
          watchActiveProjectDir();
          reload("active project changed");
          return;
        }
        const stem = resolveActiveStem();
        if (!stem) return;
        const customDir = resolveCustomElementsDir(stem);
        if (norm.startsWith(`${customDir}/`) || norm === customDir) {
          reload(`custom-elements changed (${basename(norm)})`);
        }
      };

      s.watcher.on("add", onChange);
      s.watcher.on("unlink", onChange);
      s.watcher.on("change", onChange);
    },

    load(id) {
      if (resolve(id.split("?")[0]) !== barrelAbsPath) return null;
      const stem = resolveActiveStem();
      return buildBarrelBody(stem);
    },
  };
};
