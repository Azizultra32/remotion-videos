import type React from "react";
import { AbsoluteFill, staticFile } from "remotion";
import { z } from "zod";
import { resolveStatic } from "../_helpers";
import { buildMediaEffectStyle, MediaVisualEffectSchema } from "../effectStackRuntime";
import { MediaClip } from "../MediaClip";
import { getElementFadeOpacity, getPercentBoxStyle } from "../mediaRuntime";
import type { ElementModule, ElementRendererProps } from "../types";

const blendModeSchema = z.enum([
  "normal",
  "screen",
  "multiply",
  "overlay",
  "lighten",
  "difference",
]);

const schema = z.object({
  baseImageSrc: z.string(),
  blendImageSrc: z.string(),
  fit: z.enum(["cover", "contain", "fill"]),
  x: z.number().min(-50).max(150),
  y: z.number().min(-50).max(150),
  widthPct: z.number().min(1).max(200),
  heightPct: z.number().min(1).max(200),
  fadeInSec: z.number().min(0).max(5).step(0.05),
  fadeOutSec: z.number().min(0).max(5).step(0.05),
  blendMode: blendModeSchema,
  blendOpacity: z.number().min(0).max(1).step(0.01),
  effects: z.array(MediaVisualEffectSchema).max(8),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  baseImageSrc: "",
  blendImageSrc: "",
  fit: "cover",
  x: 50,
  y: 50,
  widthPct: 100,
  heightPct: 100,
  fadeInSec: 0.2,
  fadeOutSec: 0.2,
  blendMode: "screen",
  blendOpacity: 0.65,
  effects: [],
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const {
    baseImageSrc,
    blendImageSrc,
    fit,
    x,
    y,
    widthPct,
    heightPct,
    fadeInSec,
    fadeOutSec,
    blendMode,
    blendOpacity,
    effects,
  } = element.props;

  if (!baseImageSrc) return null;

  const wrapperOpacity = getElementFadeOpacity({
    localSec: ctx.elementLocalSec,
    durationSec: element.durationSec,
    fadeInSec,
    fadeOutSec,
  });
  const wrap = getPercentBoxStyle({
    x,
    y,
    widthPct,
    heightPct,
    opacity: wrapperOpacity,
    overflowHidden: true,
  });

  const baseSrc = resolveStatic(baseImageSrc, staticFile, ctx.assetRegistry);
  const blendSrc = blendImageSrc
    ? resolveStatic(blendImageSrc, staticFile, ctx.assetRegistry)
    : null;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={wrap}>
        <div style={buildMediaEffectStyle({ absoluteFill: true })}>
          <MediaClip source={{ kind: "image", src: baseSrc }} fit={fit} />
        </div>
        {blendSrc ? (
          <div
            style={buildMediaEffectStyle({
              absoluteFill: true,
              blendMode,
              opacity: blendOpacity,
              effects,
            })}
          >
            <MediaClip source={{ kind: "image", src: blendSrc }} fit={fit} />
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export const MediaBlendCompositeModule: ElementModule<Props> = {
  id: "overlay.mediaBlend",
  category: "overlay",
  label: "Media Blend",
  description:
    "Two-image composite with ordered CSS effect filters on the blend layer and a configurable blend mode.",
  defaultDurationSec: 8,
  defaultTrack: 8,
  schema,
  defaults,
  mediaFields: [
    { name: "baseImageSrc", kind: "image", label: "Base image" },
    { name: "blendImageSrc", kind: "image", label: "Blend image" },
  ],
  Renderer,
};
