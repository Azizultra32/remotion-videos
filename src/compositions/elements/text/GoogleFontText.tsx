import type React from "react";
import { AbsoluteFill, interpolate, spring } from "remotion";
import { z } from "zod";
import type { ElementModule, ElementRendererProps } from "../types";

// Pre-import a curated set of Google Fonts via @remotion/google-fonts.
// Dynamically importing all ~1500 Google Fonts would bloat the bundle;
// these 8 cover the overwhelming majority of music-video typography
// needs (clean sans, geometric, display, mono, serif). Adding a new
// font is a one-line import here — no Renderer changes needed.
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";
import { loadFont as loadRoboto } from "@remotion/google-fonts/Roboto";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as loadBebasNeue } from "@remotion/google-fonts/BebasNeue";
import { loadFont as loadPlayfairDisplay } from "@remotion/google-fonts/PlayfairDisplay";
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald";
import { loadFont as loadJetBrainsMono } from "@remotion/google-fonts/JetBrainsMono";

// Load every font once at module evaluation. loadFont is idempotent +
// cached internally, so calling it per-render is safe, but hoisting the
// call avoids per-frame overhead and makes the font available from
// frame 0 without a delayRender dance.
const FONT_REGISTRY = {
  Inter: loadInter().fontFamily,
  Poppins: loadPoppins().fontFamily,
  Roboto: loadRoboto().fontFamily,
  Montserrat: loadMontserrat().fontFamily,
  "Bebas Neue": loadBebasNeue().fontFamily,
  "Playfair Display": loadPlayfairDisplay().fontFamily,
  Oswald: loadOswald().fontFamily,
  "JetBrains Mono": loadJetBrainsMono().fontFamily,
} as const;

const FONT_NAMES = [
  "Inter",
  "Poppins",
  "Roboto",
  "Montserrat",
  "Bebas Neue",
  "Playfair Display",
  "Oswald",
  "JetBrains Mono",
] as const;

const schema = z.object({
  text: z.string(),
  fontName: z.enum(FONT_NAMES),
  fontSize: z.number().min(12).max(600),
  fontWeight: z.number().min(100).max(900),
  italic: z.boolean(),
  color: z.string(),
  letterSpacing: z.string(),
  textAlign: z.enum(["left", "center", "right"]),
  x: z.number().min(-50).max(150),
  y: z.number().min(-50).max(150),
  widthPct: z.number().min(1).max(200),
  entrance: z.enum(["none", "fade", "spring-scale", "spring-y"]),
  // spring params visualized by ElementDetail's SpringCurveVisualizer
  damping: z.number().min(1).max(50),
  stiffness: z.number().min(1).max(500),
  mass: z.number().min(0.1).max(10),
  fadeInSec: z.number().min(0).max(5),
  fadeOutSec: z.number().min(0).max(5),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  text: "HEADLINE",
  fontName: "Inter",
  fontSize: 120,
  fontWeight: 700,
  italic: false,
  color: "#ffffff",
  letterSpacing: "-0.02em",
  textAlign: "center",
  x: 50,
  y: 50,
  widthPct: 90,
  entrance: "spring-scale",
  damping: 15,
  stiffness: 120,
  mass: 1,
  fadeInSec: 0,
  fadeOutSec: 0.3,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const {
    text,
    fontName,
    fontSize,
    fontWeight,
    italic,
    color,
    letterSpacing,
    textAlign,
    x,
    y,
    widthPct,
    entrance,
    damping,
    stiffness,
    mass,
    fadeInSec,
    fadeOutSec,
  } = element.props;

  const localSec = ctx.elementLocalSec;
  const durationSec = element.durationSec;
  const elementFrames = Math.max(1, Math.round(durationSec * ctx.fps));
  const localFrame = Math.max(0, Math.min(elementFrames - 1, Math.round(localSec * ctx.fps)));

  const springVal =
    entrance === "none" || entrance === "fade"
      ? 1
      : spring({
          frame: localFrame,
          fps: ctx.fps,
          config: { damping, stiffness, mass },
          durationInFrames: elementFrames,
        });

  const fadeIn = fadeInSec <= 0 ? 1 : interpolate(localSec, [0, fadeInSec], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = fadeOutSec <= 0 ? 1 : interpolate(localSec, [Math.max(0, durationSec - fadeOutSec), durationSec], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const envelopeOpacity = fadeIn * fadeOut;

  const scale = entrance === "spring-scale" ? springVal : 1;
  const yOffset = entrance === "spring-y" ? (1 - springVal) * 40 : 0;
  const entranceOpacity = entrance === "fade" ? springVal : 1;

  const opacity = envelopeOpacity * entranceOpacity;
  const fontFamily = FONT_REGISTRY[fontName];

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: `${x - widthPct / 2}%`,
          top: `${y}%`,
          width: `${widthPct}%`,
          transform: `translate(0, calc(-50% + ${yOffset}px)) scale(${scale})`,
          transformOrigin: "center",
          fontFamily,
          fontSize,
          fontWeight,
          fontStyle: italic ? "italic" : "normal",
          color,
          letterSpacing,
          textAlign,
          opacity,
          lineHeight: 1.1,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

const GoogleFontTextModule: ElementModule<Props> = {
  id: "text.googleFont",
  category: "text",
  label: "Google Font Text",
  description: "Typography with a loaded Google Font (Inter, Poppins, Bebas Neue, etc.).",
  defaultDurationSec: 3,
  defaultTrack: 0,
  schema,
  defaults,
  Renderer,
};

export default GoogleFontTextModule;
export { GoogleFontTextModule };
