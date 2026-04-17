import React from "react";
import { z } from "zod";
import type { ElementModule, ElementRendererProps } from "../types";

const schema = z.object({
  position: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]),
  widthPx: z.number(),
  heightPx: z.number(),
  offsetPx: z.number(),
  background: z.string(),
  blurPx: z.number(),
  opacity: z.number(),
  borderRadius: z.number(),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  position: "bottom-right",
  widthPx: 180,
  heightPx: 60,
  offsetPx: 8,
  background: "#000000",
  blurPx: 12,
  opacity: 1,
  borderRadius: 0,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element }) => {
  const { position, widthPx, heightPx, offsetPx, background, blurPx, opacity, borderRadius } = element.props;
  const pos: React.CSSProperties = { position: "absolute" };
  if (position.startsWith("top")) pos.top = offsetPx; else pos.bottom = offsetPx;
  if (position.endsWith("left")) pos.left = offsetPx; else pos.right = offsetPx;
  return (
    <div
      style={{
        ...pos,
        width: widthPx,
        height: heightPx,
        background,
        opacity,
        backdropFilter: `blur(${blurPx}px)`,
        WebkitBackdropFilter: `blur(${blurPx}px)`,
        borderRadius,
        pointerEvents: "none",
      }}
    />
  );
};

export const WatermarkMaskModule: ElementModule<Props> = {
  id: "overlay.watermarkMask",
  category: "overlay",
  label: "Watermark Mask",
  description: "Configurable opaque panel to hide a corner watermark",
  defaultDurationSec: 600,
  defaultTrack: 7,
  schema,
  defaults,
  Renderer,
};
