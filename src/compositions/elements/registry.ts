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
import { StaticImageModule } from "./overlays/StaticImage";
import { GlitchShockModule } from "./overlays/GlitchShock";
import { PlasmaBackdropModule } from "./overlays/PlasmaBackdrop";
import { ShaderPulseModule } from "./overlays/ShaderPulse";
import { MotionBlurTextModule } from "./overlays/MotionBlurText";
import { SceneTransitionModule } from "./overlays/SceneTransition";
import { LottieClipModule } from "./overlays/LottieClip";
import { GifClipModule } from "./overlays/GifClip";
import { CaptionsModule } from "./overlays/Captions";
import { IFrameEmbedModule } from "./overlays/IFrameEmbed";
import { NoiseFieldModule } from "./overlays/NoiseField";
import { GoogleFontTextModule } from "./text/GoogleFontText";
import { VideoClipModule } from "./overlays/VideoClip";
import { WatermarkMaskModule } from "./overlays/WatermarkMask";
import { NeonStrokeStackModule } from "./shapes/NeonStrokeStack";
import { PathRevealModule } from "./shapes/PathReveal";
import { SonarRingsModule } from "./shapes/SonarRings";
import { ShapeClipModule } from "./shapes/ShapeClip";
import { BeatDropWordsModule } from "./text/BeatDropWords";
import { BellCurveRevealModule } from "./text/BellCurveReveal";
import { FitboxSVGWordModule } from "./text/FitboxSVGWord";
import { GlitchTextModule } from "./text/GlitchText";
import { PoppingTextModule } from "./text/PoppingText";
import { SlidingTextModule } from "./text/SlidingText";
import { TypingTextModule } from "./text/TypingText";
// Per-project custom elements — populated by the renderer barrel generator
// (scripts/cli/mv-render.ts) before each bundle, empty by default in the
// editor. See ./_generated-custom-elements.ts for the contract.
import { PROJECT_CUSTOM_ELEMENTS } from "./_generated-custom-elements";
import type { ElementModule } from "./types";

// Engine built-in modules — the shared effects library. Stable across projects.
// Per-project custom modules are appended below via PROJECT_CUSTOM_ELEMENTS.
const ENGINE_ELEMENT_MODULES: ElementModule<any>[] = [
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
  StaticImageModule,
  OscilloscopeModule,
  PlasmaBackdropModule,
  SpectrumWaterfallModule,
  MotionBlurTextModule,
  SceneTransitionModule,
  ShapeClipModule,
  LottieClipModule,
  GifClipModule,
  CaptionsModule,
  IFrameEmbedModule,
  NoiseFieldModule,
  GoogleFontTextModule,
];

// Merge built-ins with per-project custom elements. Later entries win on id
// collision, so a project can override an engine module for its own render
// (intentional — lets a track tune a primitive without forking the engine).
export const ELEMENT_MODULES: ElementModule<any>[] = [
  ...ENGINE_ELEMENT_MODULES,
  ...PROJECT_CUSTOM_ELEMENTS,
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
  "overlay.staticImage": "src/compositions/elements/overlays/StaticImage.tsx",
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
  "overlay.motionBlurText": "src/compositions/elements/overlays/MotionBlurText.tsx",
  "overlay.sceneTransition": "src/compositions/elements/overlays/SceneTransition.tsx",
  "overlay.lottie": "src/compositions/elements/overlays/LottieClip.tsx",
  "overlay.gif": "src/compositions/elements/overlays/GifClip.tsx",
  "overlay.captions": "src/compositions/elements/overlays/Captions.tsx",
  "overlay.iframe": "src/compositions/elements/overlays/IFrameEmbed.tsx",
  "overlay.noise": "src/compositions/elements/overlays/NoiseField.tsx",
  "text.googleFont": "src/compositions/elements/text/GoogleFontText.tsx",
  "shape.shapeClip": "src/compositions/elements/shapes/ShapeClip.tsx",
};

export const getElementSourcePath = (type: string): string | null =>
  ELEMENT_SOURCE_PATHS[type] ?? null;
