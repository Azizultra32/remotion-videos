// scripts/cli/paths.ts
//
// Shared path resolvers for everything engine-side that touches project
// data. One source of truth for "where do projects live" so the user
// can relocate all their tracks by setting a single env var.
//
// Projects resolution precedence (first match wins):
//   1. process.env.MV_PROJECTS_DIR  — absolute or tilde-expanded path
//   2. <engineRoot>/projects        — default; the engine repo ships with
//                                     an empty (gitignored) projects/ dir
//
// The engine repo no longer tracks project content — projects are per-user
// creative output. A fresh clone starts with projects/ empty and the engine
// creates it lazily. Users who want a different root (different drive,
// separate git repo, external volume) set MV_PROJECTS_DIR before launching
// npm run dev / any mv:* CLI.
//
// On boot (sidecar or CLI), call ensureProjectsDir(engineRoot) to create
// the dir if missing. syncStaticProjectsSymlink(engineRoot) also keeps
// public/projects pointed at the right place, which Remotion renders
// depend on via staticFile("projects/<stem>/audio.mp3").

import { existsSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const expand = (p: string): string => {
  // Lightweight ~-expansion. Node's resolve() doesn't do it and we don't
  // want a shell round-trip.
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  if (p === "~") return homedir();
  return p;
};

export const resolveProjectsDir = (engineRoot: string): string => {
  const override = process.env.MV_PROJECTS_DIR;
  if (override?.trim()) {
    return resolve(expand(override.trim()));
  }
  return join(engineRoot, "projects");
};

export const resolveProjectDir = (engineRoot: string, stem: string): string =>
  join(resolveProjectsDir(engineRoot), stem);

/**
 * Create the projects root if it doesn't exist yet (e.g. fresh clone with
 * no tracks). Idempotent. Returns the resolved path.
 */
export const ensureProjectsDir = (engineRoot: string): string => {
  const dir = resolveProjectsDir(engineRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
};

/**
 * Resolve the actual audio file inside a project dir. mv:scaffold
 * preserves the source extension (.mp3/.wav/.m4a) — hardcoding .mp3
 * in consumers broke .wav projects silently. This checks each known
 * extension and returns the first that exists. Returns null if none.
 */
export const resolveAudioPath = (projectDir: string): {
  fullPath: string;
  filename: string;
  ext: ".mp3" | ".wav" | ".m4a";
} | null => {
  const candidates: Array<{ filename: string; ext: ".mp3" | ".wav" | ".m4a" }> = [
    { filename: "audio.mp3", ext: ".mp3" },
    { filename: "audio.wav", ext: ".wav" },
    { filename: "audio.m4a", ext: ".m4a" },
  ];
  for (const c of candidates) {
    const fullPath = join(projectDir, c.filename);
    if (existsSync(fullPath)) return { fullPath, filename: c.filename, ext: c.ext };
  }
  return null;
};

/**
 * Remotion's staticFile("projects/<stem>/audio.mp3") resolves to
 * <engineRoot>/public/projects/<stem>/audio.mp3, which is served via a
 * symlink at <engineRoot>/public/projects pointing at the projects root.
 *
 * If the user sets MV_PROJECTS_DIR to an external location, the stock
 * "public/projects -> ../projects" symlink still points at the engine-
 * local (empty) dir. Keeping renders working means updating the symlink.
 *
 * This function makes public/projects point at resolveProjectsDir().
 * Called on sidecar boot and by the render CLI. Idempotent — re-links only
 * if the current target is wrong.
 */
export const syncStaticProjectsSymlink = (engineRoot: string): void => {
  const target = resolveProjectsDir(engineRoot);
  const defaultTarget = join(engineRoot, "projects");
  const linkPath = join(engineRoot, "public", "projects");
  // When the user hasn't overridden MV_PROJECTS_DIR, keep the symlink
  // RELATIVE ("../projects") so the repo stays portable across machines.
  // When they HAVE overridden, the symlink is per-machine by definition —
  // use the absolute path. public/projects is tracked in git, so a
  // portable default value avoids committing machine-specific absolute
  // paths by accident.
  const linkTarget = target === defaultTarget ? "../projects" : target;
  let needsLink = true;
  try {
    const current = readlinkSync(linkPath);
    if (current === linkTarget) needsLink = false;
  } catch {
    // Link doesn't exist or isn't a symlink; we'll (re)create it.
  }
  if (!needsLink) return;
  try {
    unlinkSync(linkPath);
  } catch {
    // Not present or not removable; symlinkSync below will throw if a
    // real file is in the way, which is the right failure mode.
  }
  symlinkSync(linkTarget, linkPath);
};
