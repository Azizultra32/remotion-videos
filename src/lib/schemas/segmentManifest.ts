import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { renderTargetSchema } from "./projectManifest";

export const SEGMENT_MANIFEST_FILENAME = "segment.json";

/**
 * Mini-manifest for a single segment of a longer project. Lives inside
 * projects/<project>/segments/<segment-name>/segment.json after
 * `extract-segments.sh` (Task #15) slices the parent project.
 *
 * All timestamps in segment-local media (audio, video, beats) are rebased
 * to 0 so the segment can be worked on in isolation without doing time-math
 * relative to the parent. `timeRangeInParent` records where this segment
 * sits in the parent audio so the editor can still show global context.
 */
export const segmentManifestSchema = z.object({
  $schema: z.string().optional(),
  segmentName: z.string().describe("Stable slug name from segment-audio.py (e.g. '03-drop')"),
  parentProject: z.string().describe("Relative or absolute path to the parent project.json"),

  timeRangeInParent: z.object({
    startSec: z.number().describe("Segment start in parent audio (seconds)"),
    endSec: z.number().describe("Segment end in parent audio (seconds)"),
  }),

  localMedia: z.object({
    audio: z.string().describe("Segment-local audio file (relative to segment.json)"),
    video: z.string().optional().describe("Segment-local video file (relative to segment.json)"),
    beats: z.string().describe("Segment-local beats.json (rebased to 0, relative to segment.json)"),
    energy: z.string().optional(),
    spectrum: z.string().optional(),
  }),

  /**
   * Segments can override the parent project's render target (different comp,
   * codec, fps). If omitted, the renderer uses the parent's render config.
   */
  renderOverride: renderTargetSchema.partial().optional(),

  /** Per-segment editor state (draggable elements positioned on this segment's timeline). */
  editorState: z.string().optional(),

  /** Tag/reason from segment-audio.py: 'drop-region' | 'breakdown' | 'regular' | 'intro' | 'outro' | ... */
  reason: z.string().optional(),

  /** Counters from segment-audio.py. */
  containsDrops: z.number().int().nonnegative().optional(),
  containsBreakdowns: z.number().int().nonnegative().optional(),

  /** Output file for THIS segment's render (relative to segment.json or absolute). */
  output: z
    .string()
    .optional()
    .describe("Per-segment render output path. If omitted, falls back to parent."),
});

export type SegmentManifest = z.infer<typeof segmentManifestSchema>;

const expandHome = (p: string): string => {
  if (p.startsWith("~/") || p === "~") {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    return p.replace(/^~/, home);
  }
  return p;
};

export const resolveSegmentPath = (segmentManifestPath: string, fieldValue: string): string => {
  const expanded = expandHome(fieldValue);
  if (isAbsolute(expanded)) return expanded;
  return resolve(dirname(segmentManifestPath), expanded);
};

export type LoadSegmentResult =
  | { ok: true; manifest: SegmentManifest; manifestPath: string }
  | { ok: false; error: string; zodIssues?: z.ZodIssue[] };

export const loadSegmentManifest = (path: string): LoadSegmentResult => {
  if (!existsSync(path)) {
    return { ok: false, error: `Segment manifest not found: ${path}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { ok: false, error: `Invalid JSON in ${path}: ${(e as Error).message}` };
  }
  const parsed = segmentManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Segment manifest failed validation: ${path}`,
      zodIssues: parsed.error.issues,
    };
  }
  return { ok: true, manifest: parsed.data, manifestPath: path };
};

/**
 * Convenience: take a segment entry (as emitted by segment-audio.py) plus a
 * parent project path, and produce a scaffold SegmentManifest that
 * extract-segments.sh can flesh out with local file paths.
 */
export const buildSegmentManifestScaffold = (opts: {
  segmentName: string;
  parentProject: string;
  startSec: number;
  endSec: number;
  reason?: string;
  containsDrops?: number;
  containsBreakdowns?: number;
}): SegmentManifest => ({
  segmentName: opts.segmentName,
  parentProject: opts.parentProject,
  timeRangeInParent: {
    startSec: opts.startSec,
    endSec: opts.endSec,
  },
  localMedia: {
    audio: "./audio.wav",
    video: "./video.mp4",
    beats: "./beats.json",
  },
  reason: opts.reason,
  containsDrops: opts.containsDrops,
  containsBreakdowns: opts.containsBreakdowns,
});
