import type React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig, staticFile } from "remotion";
import { z } from "zod";
import type { ElementModule, ElementRendererProps } from "../types";

// Static image overlay. A single image, positioned on the composition with
// fit/width/height/offset, wrapped in optional fade-in and fade-out envelopes.
// Exists because BeatImageCycle — which also takes a list of images — is
// semantically "cycle through these on every Nth beat". The "I dropped a
// photo onto the timeline" case wants this, not cycling: one image, shown
// for the element duration, optionally fading in and out.
//
// Deterministic: no randomness. At any frame the pixel is a pure function
// of (imageSrc, element duration, playhead frame, fade envelopes).

const schema = z.object({
  imageSrc: z.string(),
  fit: z.enum(["cover", "contain"]),
  x: z.number().min(-50).max(150),         // center x in %
  y: z.number().min(-50).max(150),         // center y in %
  widthPct: z.number().min(1).max(200),
  heightPct: z.number().min(1).max(200),
  fadeInSec: z.number().min(0).max(5).step(0.05),
  fadeOutSec: z.number().min(0).max(5).step(0.05),
  opacity: z.number().min(0).max(1).step(0.01),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  imageSrc: "",
  fit: "cover",
  x: 50,
  y: 50,
  widthPct: 100,
  heightPct: 100,
  fadeInSec: 0.3,
  fadeOutSec: 0.3,
  opacity: 1,
};

const resolvePath = (p: string): string =>
  p.startsWith("http") || p.startsWith("/") ? p : staticFile(p);

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element }) => {
  const { imageSrc, fit, x, y, widthPct, heightPct, fadeInSec, fadeOutSec, opacity } =
    element.props;

  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const elementLocalSec = frame / fps;
  const elementDurationSec = durationInFrames / fps;

  if (!imageSrc) return null;
  const resolved = resolvePath(imageSrc);

  // Fade in: 0 -> 1 over fadeInSec starting at t=0.
  const fadeInOpacity = interpolate(elementLocalSec, [0, Math.max(0.0001, fadeInSec)], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Fade out: 1 -> 0 over the last fadeOutSec of the element duration.
  const fadeOutStartSec = Math.max(fadeInSec, elementDurationSec - fadeOutSec);
  const fadeOutOpacity = interpolate(
    elementLocalSec,
    [fadeOutStartSec, elementDurationSec],
    [1, 0],
    { extrapolateRight: "clamp" },
  );

  const combinedOpacity = fadeInOpacity * fadeOutOpacity * opacity;

  const wrap: React.CSSProperties = {
    position: "absolute",
    left: `${x - widthPct / 2}%`,
    top: `${y - heightPct / 2}%`,
    width: `${widthPct}%`,
    height: `${heightPct}%`,
    pointerEvents: "none",
  };

  const imgStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: fit,
    opacity: combinedOpacity,
  };

  return (
    <AbsoluteFill>
      <div style={wrap}>
        <Img src={resolved} style={imgStyle} />
      </div>
    </AbsoluteFill>
  );
};

export const StaticImageModule: ElementModule<Props> = {
  id: "overlay.staticImage",
  category: "overlay",
  label: "Static Image",
  description: "Single image overlay with fit, position, width/height, and fade-in / fade-out envelopes.",
  defaultDurationSec: 10,
  defaultTrack: 7,
  schema,
  defaults,
  Renderer,
};
