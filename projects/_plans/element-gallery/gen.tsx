// Render one still per registered element, write to
// projects/_plans/element-gallery/<id>.png so users (and the editor)
// can see what each element looks like with its own defaults.
//
// Runs programmatically via @remotion/bundler + renderStill so the
// webpack bundle is built ONCE and reused across all renders — ~30x
// faster than looping `npx remotion still` which re-bundles per call.

import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ELEMENT_MODULES, ELEMENT_REGISTRY } from "../../../src/compositions/elements/registry";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../../..");
const OUT_DIR = resolve(__dirname);
mkdirSync(OUT_DIR, { recursive: true });

// For media-needing elements, prefer the first available asset under
// public/ so the thumbnail is a real preview and not a blank frame.
const PLACEHOLDER_IMAGE = "assets/images/mountain.jpg"; // best-effort; may not exist

const PREVIEW_DURATION_CAP = 6; // seconds, keeps mid-frame inside comp duration

const buildElementForModule = (mod: (typeof ELEMENT_MODULES)[number]) => {
  const p = { ...mod.defaults } as Record<string, unknown>;
  // Patch elements whose defaults leave an asset-src empty (would render
  // nothing) with a placeholder path so the preview is legible.
  if (mod.id === "overlay.staticImage" && !p.imageSrc) {
    p.imageSrc = "assets/images/55a4629ffc77f363e3ec1534b8a4223b.gif";
  }
  if (mod.id === "overlay.gif" && !p.gifSrc) {
    p.gifSrc = "assets/images/55a4629ffc77f363e3ec1534b8a4223b.gif";
  }
  if (mod.id === "overlay.speedVideo" && !p.videoSrc) p.videoSrc = "";
  if (mod.id === "overlay.gif" && !p.gifSrc) p.gifSrc = "";
  if (mod.id === "overlay.lottie" && !p.jsonSrc) p.jsonSrc = "";
  return {
    id: `preview-${mod.id}`,
    type: mod.id,
    trackIndex: mod.defaultTrack ?? 0,
    startSec: 0,
    durationSec: Math.min(PREVIEW_DURATION_CAP, mod.defaultDurationSec ?? 3),
    label: mod.label,
    props: p,
  };
};

// Pick a frame roughly mid-element so fade envelopes are fully open.
const MID_FRAME = (dur: number, fps: number) => Math.round((dur * fps) / 2);

async function main() {
  console.log(`[gallery] bundling…`);
  const serveUrl = await bundle({
    entryPoint: resolve(REPO, "src/index.ts"),
    webpackOverride: (c) => c,
  });
  console.log(`[gallery] bundle ready → ${serveUrl}`);

  // Fetch once only for the width/height/fps metadata — per-element
  // inputProps is passed again to renderStill directly below.
  const metaComp = await selectComposition({
    serveUrl,
    id: "MusicVideo",
    inputProps: {},
  });
  console.log(`[gallery] composition ${metaComp.width}x${metaComp.height}@${metaComp.fps}`);

  const index: { id: string; label: string; category: string; description: string; file: string }[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const mod of ELEMENT_MODULES) {
    const element = buildElementForModule(mod);
    const midFrame = MID_FRAME(element.durationSec, metaComp.fps);
    const outFile = resolve(OUT_DIR, `${mod.id}.png`);
    // Audio-reactive + shader + beat-driven elements need real signal
    // to visualize. Wire dubfire's audio + analysis in for those; leave
    // other elements in a plain context so their render isn't blocked
    // by audio fetch.
    const needsAudio =
      mod.id.startsWith("audio.") ||
      ["overlay.shaderPulse","overlay.bloomGlow","overlay.plasmaBackdrop",
       "overlay.beatShock","overlay.beatColorFlash","overlay.beatImageCycle",
       "overlay.beatVideoCycle","overlay.glitchShock","shape.sonarRings",
       "text.beatDrop","overlay.preDropFadeHold"].includes(mod.id);
    const inputProps = {
      audioSrc: needsAudio ? "projects/dubfire-short/audio.mp3" : null,
      beatsSrc: needsAudio ? "projects/dubfire-short/analysis.json" : null,
      events: [],
      muteAudioTag: true,
      analysisAudioSrc: needsAudio ? "projects/dubfire-short/audio.mp3" : null,
      elements: [element],
    };
    try {
      const elComp = await selectComposition({
        serveUrl,
        id: "MusicVideo",
        inputProps,
      });
      await renderStill({
        composition: elComp,
        serveUrl,
        frame: midFrame,
        output: outFile,
        inputProps,
        chromiumOptions: { headless: true },
      });
      index.push({
        id: mod.id,
        label: mod.label,
        category: mod.category,
        description: mod.description,
        file: `${mod.id}.png`,
      });
      console.log(`[gallery] ✓ ${mod.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed.push({ id: mod.id, error: msg });
      console.warn(`[gallery] ✗ ${mod.id} — ${msg.slice(0, 120)}`);
    }
  }

  writeFileSync(
    resolve(OUT_DIR, "index.json"),
    JSON.stringify({ modules: index, failed, generatedAt: new Date().toISOString() }, null, 2),
  );
  console.log(`[gallery] done — ${index.length} ok, ${failed.length} failed`);
  console.log(`[gallery] output: ${OUT_DIR}`);
  process.exit(0);
}

void ELEMENT_REGISTRY; // keep import live for biome/ts
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
