import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export const mediaRefSchema = z.object({
  root: z.string().describe("Absolute or ~-expanded path to media folder. NOT tracked in git."),
  sourceVideo: z.string().optional().describe("Filename within root"),
  sourceAudio: z.string().optional().describe("Filename within root"),
});

export const analysisRefSchema = z.object({
  beats: z.string().describe("Path to beats.json (relative to project.json or absolute)"),
  energy: z.string().optional(),
  spectrum: z.string().optional(),
  segments: z.string().optional().describe("Path to segments.json (from segment-audio.py)"),
});

export const renderTargetSchema = z.object({
  composition: z.string().describe("Composition id registered in Root.tsx"),
  fps: z.number().int().min(1).max(120).default(24),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  codec: z
    .enum(["h264", "h265", "vp8", "vp9", "prores", "prores-4444", "prores-hq", "dnxhr-hq"])
    .default("h264"),
  output: z.string().describe("Output file path (relative to project.json or absolute)"),
});

export const projectEventSchema = z.object({
  type: z.enum(["drop", "breakdown", "section", "cue", "beat-region"]),
  time: z.number().describe("Seconds into the source audio"),
  endTime: z.number().optional().describe("For range events (breakdown, section, beat-region)"),
  label: z.string().optional(),
  notes: z.string().optional(),
});

export const projectManifestSchema = z.object({
  $schema: z.string().optional(),
  projectName: z.string().describe("Human-readable project name"),
  framework: z
    .string()
    .describe("Path to the remotion-videos framework (relative or absolute)"),
  media: mediaRefSchema,
  analysis: analysisRefSchema,
  render: renderTargetSchema,
  editorState: z
    .string()
    .optional()
    .describe("Path to edits.json produced by the editor app"),
  events: z.array(projectEventSchema).default([]),
  segmentsDir: z
    .string()
    .optional()
    .describe("Directory containing per-segment sub-manifests (see segment.json schema)"),
});

export type MediaRef = z.infer<typeof mediaRefSchema>;
export type AnalysisRef = z.infer<typeof analysisRefSchema>;
export type RenderTarget = z.infer<typeof renderTargetSchema>;
export type ProjectEvent = z.infer<typeof projectEventSchema>;
export type ProjectManifest = z.infer<typeof projectManifestSchema>;

export const MANIFEST_FILENAME = "project.json";

const expandHome = (p: string): string => {
  if (p.startsWith("~/") || p === "~") {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    return p.replace(/^~/, home);
  }
  return p;
};

/**
 * Resolve a path field from the manifest to an absolute filesystem path.
 * Rules:
 *   - Absolute paths are returned as-is (after ~ expansion).
 *   - Relative paths are resolved against the manifest's directory.
 */
export const resolveManifestPath = (
  manifestPath: string,
  fieldValue: string,
): string => {
  const expanded = expandHome(fieldValue);
  if (isAbsolute(expanded)) return expanded;
  return resolve(dirname(manifestPath), expanded);
};

/**
 * Resolve a media file (video/audio) to an absolute path using the manifest's
 * media.root plus the filename. Returns null if the field isn't set.
 */
export const resolveMediaFile = (
  manifest: ProjectManifest,
  key: "sourceVideo" | "sourceAudio",
): string | null => {
  const filename = manifest.media[key];
  if (!filename) return null;
  const root = expandHome(manifest.media.root);
  if (isAbsolute(root)) return resolve(root, filename);
  // root is relative — shouldn't normally happen, but treat as cwd-relative
  return resolve(root, filename);
};

export type LoadResult =
  | { ok: true; manifest: ProjectManifest; manifestPath: string }
  | { ok: false; error: string; zodIssues?: z.ZodIssue[] };

/**
 * Load and validate a project.json from disk. Returns a structured result so
 * callers can decide how to report errors without throwing.
 */
export const loadProjectManifest = (path: string): LoadResult => {
  if (!existsSync(path)) {
    return { ok: false, error: `Manifest not found: ${path}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { ok: false, error: `Invalid JSON in ${path}: ${(e as Error).message}` };
  }
  const parsed = projectManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Manifest failed validation: ${path}`,
      zodIssues: parsed.error.issues,
    };
  }
  return { ok: true, manifest: parsed.data, manifestPath: path };
};

/**
 * Produce a minimal default manifest. Useful for `scripts/new-project.ts` or
 * the music-video-project skill's scaffolding flow.
 */
export const buildDefaultManifest = (opts: {
  projectName: string;
  framework: string;
  mediaRoot: string;
  sourceVideo?: string;
  sourceAudio?: string;
  beatsPath?: string;
  composition?: string;
}): ProjectManifest => ({
  projectName: opts.projectName,
  framework: opts.framework,
  media: {
    root: opts.mediaRoot,
    sourceVideo: opts.sourceVideo,
    sourceAudio: opts.sourceAudio,
  },
  analysis: {
    beats: opts.beatsPath ?? "./beats.json",
  },
  render: {
    composition: opts.composition ?? "BeatDrop",
    fps: 24,
    width: 848,
    height: 480,
    codec: "h264",
    output: "./renders/out.mp4",
  },
  events: [],
});
