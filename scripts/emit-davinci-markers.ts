#!/usr/bin/env tsx
/**
 * Emit a DaVinci-importable marker EDL from a beats.json file.
 *
 * DaVinci Resolve understands:
 *   - EDL (CMX 3600) — universal, simple format. This is what we use.
 *   - FCPXML — richer but much more verbose; skipped for now.
 *
 * EDL marker format:
 *   TITLE: Beat Markers
 *   FCM: NON-DROP FRAME
 *
 *   001  AX       V     C        00:00:00:00 00:00:00:01 00:00:00:00 00:00:00:01
 *   * FROM CLIP NAME: <source>
 *   * MARKER 1 RED Downbeat|00:00:12:03
 *   * MARKER 2 BLUE Drop|00:00:45:12
 *
 * Usage:
 *   tsx scripts/emit-davinci-markers.ts --beats public/dubfire-beats.json \
 *     --video out/PublicCut-abc123.mov --out out/PublicCut-abc123-markers.edl
 *
 * Options:
 *   --beats <file>    Path to beats.json
 *   --video <file>    Path to rendered video (for clip name + duration)
 *   --out <file>      Path to write EDL
 *   --fps <n>         Frame rate (default 24) — must match the render
 *   --include-beats   If present, marks EVERY beat (very noisy, default false)
 *   --include-downbeats  (default true) — red marker per downbeat
 *   --include-drops      (default true) — orange marker per drop
 *   --include-breakdowns (default true) — cyan markers for breakdown start/end
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

type BreakdownRegion = { start: number; end: number };
type BeatsFile = {
  duration: number;
  bpm_global: number;
  beats: number[];
  downbeats: number[];
  drops?: number[];
  breakdowns?: BreakdownRegion[];
};

interface Args {
  beats: string;
  video?: string;
  out: string;
  fps: number;
  includeBeats: boolean;
  includeDownbeats: boolean;
  includeDrops: boolean;
  includeBreakdowns: boolean;
}

const parseArgs = (argv: string[]): Args => {
  const opts: Args = {
    beats: "",
    out: "",
    fps: 24,
    includeBeats: false,
    includeDownbeats: true,
    includeDrops: true,
    includeBreakdowns: true,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--beats") {
      opts.beats = next;
      i++;
    } else if (a === "--video") {
      opts.video = next;
      i++;
    } else if (a === "--out") {
      opts.out = next;
      i++;
    } else if (a === "--fps") {
      opts.fps = parseFloat(next);
      i++;
    } else if (a === "--include-beats") opts.includeBeats = true;
    else if (a === "--no-downbeats") opts.includeDownbeats = false;
    else if (a === "--no-drops") opts.includeDrops = false;
    else if (a === "--no-breakdowns") opts.includeBreakdowns = false;
  }
  if (!opts.beats || !opts.out) {
    console.error(
      "Usage: emit-davinci-markers.ts --beats <file> --out <file> [--video <file>] [--fps 24]",
    );
    process.exit(1);
  }
  return opts;
};

const secToTC = (sec: number, fps: number): string => {
  const totalFrames = Math.round(sec * fps);
  const frames = totalFrames % Math.round(fps);
  const totalSecs = Math.floor(totalFrames / fps);
  const s = totalSecs % 60;
  const m = Math.floor(totalSecs / 60) % 60;
  const h = Math.floor(totalSecs / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frames)}`;
};

type Marker = { time: number; color: string; label: string };

const buildMarkers = (beats: BeatsFile, a: Args): Marker[] => {
  const out: Marker[] = [];
  if (a.includeBeats) {
    for (const t of beats.beats) out.push({ time: t, color: "WHITE", label: "Beat" });
  }
  if (a.includeDownbeats) {
    for (const t of beats.downbeats) out.push({ time: t, color: "RED", label: "Downbeat" });
  }
  if (a.includeDrops) {
    for (const t of beats.drops ?? []) out.push({ time: t, color: "YELLOW", label: "Drop" });
  }
  if (a.includeBreakdowns) {
    for (const bd of beats.breakdowns ?? []) {
      out.push({ time: bd.start, color: "CYAN", label: "Breakdown-start" });
      out.push({ time: bd.end, color: "CYAN", label: "Breakdown-end" });
    }
  }
  // De-dupe within 1/fps so two events don't fight for the same frame.
  out.sort((x, y) => x.time - y.time);
  const minGap = 1.0 / a.fps;
  const deduped: Marker[] = [];
  for (const m of out) {
    if (deduped.length === 0 || m.time - deduped[deduped.length - 1].time >= minGap) {
      deduped.push(m);
    }
  }
  return deduped;
};

const buildEDL = (clipName: string, duration: number, fps: number, markers: Marker[]): string => {
  const lines: string[] = [];
  lines.push(`TITLE: ${clipName} Markers`);
  lines.push("FCM: NON-DROP FRAME");
  lines.push("");
  // Single clip entry covering the full duration.
  const durTC = secToTC(duration, fps);
  lines.push(`001  AX       V     C        00:00:00:00 ${durTC} 00:00:00:00 ${durTC}`);
  lines.push(`* FROM CLIP NAME: ${clipName}`);
  // Markers as EDL comments — DaVinci parses these as timeline markers.
  markers.forEach((m, idx) => {
    const tc = secToTC(m.time, fps);
    lines.push(`* MARKER ${idx + 1} ${m.color} ${m.label}|${tc}`);
  });
  lines.push("");
  return lines.join("\n");
};

const main = () => {
  const args = parseArgs(process.argv);
  const beats: BeatsFile = JSON.parse(readFileSync(args.beats, "utf8"));
  const clipName = args.video ? basename(args.video) : "Render";
  const markers = buildMarkers(beats, args);
  const edl = buildEDL(clipName, beats.duration, args.fps, markers);
  writeFileSync(args.out, edl);
  console.log(`Wrote ${args.out}`);
  console.log(`  clip: ${clipName}  duration: ${beats.duration.toFixed(2)}s  fps: ${args.fps}`);
  console.log(
    `  markers: ${markers.length} (downbeats=${args.includeDownbeats ? (beats.downbeats?.length ?? 0) : 0}, drops=${args.includeDrops ? (beats.drops?.length ?? 0) : 0}, breakdowns=${args.includeBreakdowns ? (beats.breakdowns?.length ?? 0) * 2 : 0})`,
  );
};

main();
