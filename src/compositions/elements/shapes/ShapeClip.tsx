import type React from "react";
import { Circle, Rect, Star, Triangle } from "@remotion/shapes";
import { AbsoluteFill, interpolate } from "remotion";
import { z } from "zod";
import type { ElementModule, ElementRendererProps } from "../types";

// Procedural shape primitive. Uses @remotion/shapes which emits SVG
// <path> elements for circle, rect, star, triangle — cleaner + more
// flexible than hand-rolled CSS shapes. Shape is positioned in viewport
// percent with a size in pixels, animated via fade envelope + optional
// rotation.
//
// Deterministic: all shape attributes derive from time-independent props;
// opacity / rotation are pure functions of the local frame.

const schema = z.object({
  shape: z.enum(["circle", "square", "star", "triangle"]),
  fillColor: z.string(),
  strokeColor: z.string(),
  strokeWidth: z.number().min(0).max(20),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  sizePx: z.number().min(10).max(2000),
  // star-only; ignored by other shapes but kept in schema so the
  // SchemaEditor has a stable set of controls
  starPoints: z.number().min(3).max(12),
  starInnerPct: z.number().min(10).max(90),
  fadeInSec: z.number().min(0).max(5),
  fadeOutSec: z.number().min(0).max(5),
  rotationsPerSec: z.number().min(-2).max(2),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  shape: "circle",
  fillColor: "#8cf",
  strokeColor: "#ffffff",
  strokeWidth: 0,
  x: 50,
  y: 50,
  sizePx: 300,
  starPoints: 5,
  starInnerPct: 40,
  fadeInSec: 0.3,
  fadeOutSec: 0.3,
  rotationsPerSec: 0,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const {
    shape,
    fillColor,
    strokeColor,
    strokeWidth,
    x,
    y,
    sizePx,
    starPoints,
    starInnerPct,
    fadeInSec,
    fadeOutSec,
    rotationsPerSec,
  } = element.props;

  // Element-local time — MusicVideo does NOT wrap elements in <Sequence>,
  // so useCurrentFrame() returns the composition-absolute frame and
  // useVideoConfig().durationInFrames is the whole composition's duration.
  // The RenderCtx provides the correct element-local values already.
  const localSec = ctx.elementLocalSec;
  const durationSec = element.durationSec;

  // Guard against fadeIn/fadeOut === 0: interpolate throws on
  // zero-length input ranges, and a 0-sec fade means "no fade" anyway.
  const fadeIn =
    fadeInSec <= 0
      ? 1
      : interpolate(localSec, [0, fadeInSec], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  const fadeOut =
    fadeOutSec <= 0
      ? 1
      : interpolate(
          localSec,
          [Math.max(0, durationSec - fadeOutSec), durationSec],
          [1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
  const opacity = fadeIn * fadeOut;

  const rotationDeg = rotationsPerSec * 360 * localSec;

  const shapeNode = (() => {
    const common = {
      fill: fillColor,
      stroke: strokeColor,
      strokeWidth,
    };
    if (shape === "circle") {
      return <Circle radius={sizePx / 2} {...common} />;
    }
    if (shape === "square") {
      return <Rect width={sizePx} height={sizePx} {...common} />;
    }
    if (shape === "star") {
      return (
        <Star
          points={starPoints}
          innerRadius={(sizePx * starInnerPct) / 200}
          outerRadius={sizePx / 2}
          {...common}
        />
      );
    }
    // triangle
    return <Triangle length={sizePx} direction="up" {...common} />;
  })();

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: `${x}%`,
          top: `${y}%`,
          transform: `translate(-50%, -50%) rotate(${rotationDeg}deg)`,
          opacity,
        }}
      >
        {shapeNode}
      </div>
    </AbsoluteFill>
  );
};

const ShapeClipModule: ElementModule<Props> = {
  id: "shape.shapeClip",
  category: "shape",
  label: "Shape",
  description: "Procedural shape: circle, square, star, or triangle.",
  defaultDurationSec: 3,
  defaultTrack: 4,
  schema,
  defaults,
  Renderer,
};

export default ShapeClipModule;
export { ShapeClipModule };
