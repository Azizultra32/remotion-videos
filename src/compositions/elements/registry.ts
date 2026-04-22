// biome-ignore-all lint/suspicious/noExplicitAny: ElementModule<any> is the registry's heterogeneous-props typing root; per-module props are validated via Zod schemas

// Per-project custom elements — populated by the renderer barrel generator
// (scripts/cli/mv-render.ts) before each bundle, empty by default in the
// editor. See ./_generated-custom-elements.ts for the contract.
import { PROJECT_CUSTOM_ELEMENTS } from "./_generated-custom-elements";
import { BassGlowOverlayModule } from "./audio/BassGlowOverlay";
import { OscilloscopeModule } from "./audio/Oscilloscope";
import { SpectrumBarsModule } from "./audio/SpectrumBars";
import { SpectrumWaterfallModule } from "./audio/SpectrumWaterfall";
import { WaveformPathModule } from "./audio/WaveformPath";
import { BeatColorFlashModule } from "./overlays/BeatColorFlash";
import { BeatImageCycleModule } from "./overlays/BeatImageCycle";
import { BeatShockModule } from "./overlays/BeatShock";
import { BeatVideoCycleModule } from "./overlays/BeatVideoCycle";
import { BloomGlowModule } from "./overlays/BloomGlow";
import { CaptionsModule } from "./overlays/Captions";
import { GifClipModule } from "./overlays/GifClip";
import { GlitchShockModule } from "./overlays/GlitchShock";
import { IFrameEmbedModule } from "./overlays/IFrameEmbed";
import { LottieClipModule } from "./overlays/LottieClip";
import { MediaBlendCompositeModule } from "./overlays/MediaBlendComposite";
import { MotionBlurTextModule } from "./overlays/MotionBlurText";
import { NoiseFieldModule } from "./overlays/NoiseField";
import { PlasmaBackdropModule } from "./overlays/PlasmaBackdrop";
import { PreDropFadeHoldModule } from "./overlays/PreDropFadeHold";
import { SceneTransitionModule } from "./overlays/SceneTransition";
import { ShaderPulseModule } from "./overlays/ShaderPulse";
import { SpeedVideoModule } from "./overlays/SpeedVideo";
import { StaticImageModule } from "./overlays/StaticImage";
import { Three3DModule } from "./overlays/Three3D";
import { VideoClipModule } from "./overlays/VideoClip";
import { WatermarkMaskModule } from "./overlays/WatermarkMask";
import { NeonStrokeStackModule } from "./shapes/NeonStrokeStack";
import { PathRevealModule } from "./shapes/PathReveal";
import { ShapeClipModule } from "./shapes/ShapeClip";
import { SonarRingsModule } from "./shapes/SonarRings";
import { BeatDropWordsModule } from "./text/BeatDropWords";
import { BellCurveRevealModule } from "./text/BellCurveReveal";
import { FitboxSVGWordModule } from "./text/FitboxSVGWord";
import { GlitchTextModule } from "./text/GlitchText";
import { GoogleFontTextModule } from "./text/GoogleFontText";
import { PoppingTextModule } from "./text/PoppingText";
import { SlidingTextModule } from "./text/SlidingText";
import { TypingTextModule } from "./text/TypingText";
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
  MediaBlendCompositeModule,
  CaptionsModule,
  IFrameEmbedModule,
  NoiseFieldModule,
  GoogleFontTextModule,
  Three3DModule,
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
  "audio.oscilloscope": "src/compositions/elements/audio/Oscilloscope.tsx",
  "audio.spectrumWaterfall": "src/compositions/elements/audio/SpectrumWaterfall.tsx",
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
  "overlay.beatColorFlash": "src/compositions/elements/overlays/BeatColorFlash.tsx",
  "overlay.beatImageCycle": "src/compositions/elements/overlays/BeatImageCycle.tsx",
  "overlay.beatShock": "src/compositions/elements/overlays/BeatShock.tsx",
  "overlay.beatVideoCycle": "src/compositions/elements/overlays/BeatVideoCycle.tsx",
  "overlay.bloomGlow": "src/compositions/elements/overlays/BloomGlow.tsx",
  "overlay.glitchShock": "src/compositions/elements/overlays/GlitchShock.tsx",
  "overlay.motionBlurText": "src/compositions/elements/overlays/MotionBlurText.tsx",
  "overlay.plasmaBackdrop": "src/compositions/elements/overlays/PlasmaBackdrop.tsx",
  "overlay.sceneTransition": "src/compositions/elements/overlays/SceneTransition.tsx",
  "overlay.shaderPulse": "src/compositions/elements/overlays/ShaderPulse.tsx",
  "overlay.speedVideo": "src/compositions/elements/overlays/SpeedVideo.tsx",
  "overlay.lottie": "src/compositions/elements/overlays/LottieClip.tsx",
  "overlay.gif": "src/compositions/elements/overlays/GifClip.tsx",
  "overlay.captions": "src/compositions/elements/overlays/Captions.tsx",
  "overlay.iframe": "src/compositions/elements/overlays/IFrameEmbed.tsx",
  "overlay.mediaBlend": "src/compositions/elements/overlays/MediaBlendComposite.tsx",
  "overlay.noise": "src/compositions/elements/overlays/NoiseField.tsx",
  "overlay.three3D": "src/compositions/elements/overlays/Three3D.tsx",
  "text.googleFont": "src/compositions/elements/text/GoogleFontText.tsx",
  "shape.shapeClip": "src/compositions/elements/shapes/ShapeClip.tsx",
};

export const getElementSourcePath = (type: string): string | null =>
  ELEMENT_SOURCE_PATHS[type] ?? null;
