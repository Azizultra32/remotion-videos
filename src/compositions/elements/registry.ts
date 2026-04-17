import type { ElementModule } from "./types";
import { TypingTextModule } from "./text/TypingText";
import { GlitchTextModule } from "./text/GlitchText";
import { PoppingTextModule } from "./text/PoppingText";
import { SlidingTextModule } from "./text/SlidingText";
import { BellCurveRevealModule } from "./text/BellCurveReveal";
import { BeatDropWordsModule } from "./text/BeatDropWords";
import { FitboxSVGWordModule } from "./text/FitboxSVGWord";
import { SpectrumBarsModule } from "./audio/SpectrumBars";
import { WaveformPathModule } from "./audio/WaveformPath";
import { BassGlowOverlayModule } from "./audio/BassGlowOverlay";
import { PathRevealModule } from "./shapes/PathReveal";
import { NeonStrokeStackModule } from "./shapes/NeonStrokeStack";
import { SonarRingsModule } from "./shapes/SonarRings";
import { PreDropFadeHoldModule } from "./overlays/PreDropFadeHold";
import { WatermarkMaskModule } from "./overlays/WatermarkMask";
import { VideoClipModule } from "./overlays/VideoClip";

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
];

export const ELEMENT_REGISTRY: Record<string, ElementModule<any>> =
  Object.fromEntries(ELEMENT_MODULES.map((m) => [m.id, m]));

export const getElementModule = (type: string): ElementModule<any> | null =>
  ELEMENT_REGISTRY[type] ?? null;

export const listByCategory = (): Record<string, ElementModule<any>[]> => {
  const out: Record<string, ElementModule<any>[]> = {};
  for (const m of ELEMENT_MODULES) {
    (out[m.category] ||= []).push(m);
  }
  return out;
};
