// biome-ignore-all lint/suspicious/noExplicitAny: ElementModule<any> is the registry's heterogeneous-props typing root; per-module props are validated via Zod schemas

import { BassGlowOverlayModule } from "./audio/BassGlowOverlay";
import { OscilloscopeModule } from "./audio/Oscilloscope";
import { SpectrumWaterfallModule } from "./audio/SpectrumWaterfall";
import { SpectrumBarsModule } from "./audio/SpectrumBars";
import { WaveformPathModule } from "./audio/WaveformPath";
import { PreDropFadeHoldModule } from "./overlays/PreDropFadeHold";
import { BeatShockModule } from "./overlays/BeatShock";
import { BloomGlowModule } from "./overlays/BloomGlow";
import { BeatColorFlashModule } from "./overlays/BeatColorFlash";
import { BeatImageCycleModule } from "./overlays/BeatImageCycle";
import { BeatVideoCycleModule } from "./overlays/BeatVideoCycle";
import { SpeedVideoModule } from "./overlays/SpeedVideo";
import { GlitchShockModule } from "./overlays/GlitchShock";
import { PlasmaBackdropModule } from "./overlays/PlasmaBackdrop";
import { ShaderPulseModule } from "./overlays/ShaderPulse";
import { VideoClipModule } from "./overlays/VideoClip";
import { WatermarkMaskModule } from "./overlays/WatermarkMask";
import { NeonStrokeStackModule } from "./shapes/NeonStrokeStack";
import { PathRevealModule } from "./shapes/PathReveal";
import { SonarRingsModule } from "./shapes/SonarRings";
import { BeatDropWordsModule } from "./text/BeatDropWords";
import { BellCurveRevealModule } from "./text/BellCurveReveal";
import { FitboxSVGWordModule } from "./text/FitboxSVGWord";
import { GlitchTextModule } from "./text/GlitchText";
import { PoppingTextModule } from "./text/PoppingText";
import { SlidingTextModule } from "./text/SlidingText";
import { TypingTextModule } from "./text/TypingText";
import type { ElementModule } from "./types";

export const ELEMENT_MODULES: ElementModule<any>[] = [
  TypingTextModule,
  GlitchTextModule,
  PoppingTextModule,
  SlidingTextModule,
  BellCurveRevealModule,
  BeatDropWordsModule,
  FitboxSVGWordModule,
  SpectrumBarsModule,
  WaveformPathModule,
  BassGlowOverlayModule,
  PathRevealModule,
  NeonStrokeStackModule,
  SonarRingsModule,
  PreDropFadeHoldModule,
  WatermarkMaskModule,
  VideoClipModule,
  ShaderPulseModule,
  BeatShockModule,
  BloomGlowModule,
  BeatColorFlashModule,
  BeatImageCycleModule,
  BeatVideoCycleModule,
  GlitchShockModule,
  SpeedVideoModule,
  OscilloscopeModule,
  PlasmaBackdropModule,
  SpectrumWaterfallModule,
];

export const ELEMENT_REGISTRY: Record<string, ElementModule<any>> = Object.fromEntries(
  ELEMENT_MODULES.map((m) => [m.id, m]),
);

export const getElementModule = (type: string): ElementModule<any> | null =>
  ELEMENT_REGISTRY[type] ?? null;

export const listByCategory = (): Record<string, ElementModule<any>[]> => {
  const out: Record<string, ElementModule<any>[]> = {};
  for (const m of ELEMENT_MODULES) {
    if (!out[m.category]) out[m.category] = [];
    out[m.category].push(m);
  }
  return out;
};

// Repo-relative source path for each element module, consumed by the editor's
// "double-click → open source" affordance (editor/src/utils/openInEditor.ts).
// Keep in sync with module imports above; unit-tested against ELEMENT_MODULES.
export const ELEMENT_SOURCE_PATHS: Record<string, string> = {
  "audio.bassGlow": "src/compositions/elements/audio/BassGlowOverlay.tsx",
  "audio.spectrumBars": "src/compositions/elements/audio/SpectrumBars.tsx",
  "audio.waveformPath": "src/compositions/elements/audio/WaveformPath.tsx",
  "overlay.preDropFadeHold": "src/compositions/elements/overlays/PreDropFadeHold.tsx",
  "overlay.videoClip": "src/compositions/elements/overlays/VideoClip.tsx",
  "overlay.watermarkMask": "src/compositions/elements/overlays/WatermarkMask.tsx",
  "shape.neonStack": "src/compositions/elements/shapes/NeonStrokeStack.tsx",
  "shape.pathReveal": "src/compositions/elements/shapes/PathReveal.tsx",
  "shape.sonarRings": "src/compositions/elements/shapes/SonarRings.tsx",
  "text.beatDrop": "src/compositions/elements/text/BeatDropWords.tsx",
  "text.bellCurve": "src/compositions/elements/text/BellCurveReveal.tsx",
  "text.fitboxSVG": "src/compositions/elements/text/FitboxSVGWord.tsx",
  "text.glitch": "src/compositions/elements/text/GlitchText.tsx",
  "text.popping": "src/compositions/elements/text/PoppingText.tsx",
  "text.sliding": "src/compositions/elements/text/SlidingText.tsx",
  "text.typing": "src/compositions/elements/text/TypingText.tsx",
};

export const getElementSourcePath = (type: string): string | null =>
  ELEMENT_SOURCE_PATHS[type] ?? null;
