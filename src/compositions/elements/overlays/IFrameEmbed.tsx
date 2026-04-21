import type React from "react";
import { AbsoluteFill, IFrame, interpolate } from "remotion";
import { z } from "zod";
import type { ElementModule, ElementRendererProps } from "../types";

// External web content embed via Remotion's <IFrame>. Renders any URL
// (YouTube, Twitter, a custom HTML page, etc.) at a specified position
// with fade envelope. Same-origin or CSP-friendly content only — cross-
// origin iframes work for visual purposes but are not scriptable.

const schema = z.object({
  src: z.string(),
  x: z.number().min(-50).max(150),
  y: z.number().min(-50).max(150),
  widthPct: z.number().min(1).max(200),
  heightPct: z.number().min(1).max(200),
  borderRadius: z.number().min(0).max(200),
  background: z.string(),
  fadeInSec: z.number().min(0).max(5),
  fadeOutSec: z.number().min(0).max(5),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  src: "https://www.remotion.dev",
  x: 50,
  y: 50,
  widthPct: 80,
  heightPct: 80,
  borderRadius: 8,
  background: "#ffffff",
  fadeInSec: 0.3,
  fadeOutSec: 0.3,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { src, x, y, widthPct, heightPct, borderRadius, background, fadeInSec, fadeOutSec } =
    element.props;

  if (!src) return null;

  const localSec = ctx.elementLocalSec;
  const durationSec = element.durationSec;
  const fadeIn = fadeInSec <= 0 ? 1 : interpolate(localSec, [0, fadeInSec], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = fadeOutSec <= 0 ? 1 : interpolate(localSec, [Math.max(0, durationSec - fadeOutSec), durationSec], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const opacity = fadeIn * fadeOut;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: `${x - widthPct / 2}%`,
          top: `${y - heightPct / 2}%`,
          width: `${widthPct}%`,
          height: `${heightPct}%`,
          borderRadius,
          overflow: "hidden",
          background,
          opacity,
        }}
      >
        <IFrame
          src={src}
          style={{ width: "100%", height: "100%", border: "none" }}
        />
      </div>
    </AbsoluteFill>
  );
};

const IFrameEmbedModule: ElementModule<Props> = {
  id: "overlay.iframe",
  category: "overlay",
  label: "Web Embed",
  description: "Embed any URL as a live web frame on the composition.",
  defaultDurationSec: 3,
  defaultTrack: 6,
  schema,
  defaults,
  Renderer,
};

export default IFrameEmbedModule;
export { IFrameEmbedModule };
