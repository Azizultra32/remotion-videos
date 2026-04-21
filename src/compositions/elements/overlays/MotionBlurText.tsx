import type React from "react";
import { Trail } from "@remotion/motion-blur";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import type { ElementModule, ElementRendererProps } from "../types";

// Text that slides across the frame with a motion-blur trail. Uses
// @remotion/motion-blur's <Trail> which stacks N lagged copies of its
// children with decaying opacity, producing a procedural blur that
// sells "fast movement" without a post-production shader pass.
//
// The text tweens from (fromX, fromY) to (toX, toY) in viewport percent.
// Spring or linear animation. Trail layers + lagInFrames tune the blur
// amount — higher layers + longer lag = smear.
//
// Deterministic: at any frame the pixel is a pure function of the
// element's local time and props.

const schema = z.object({
  text: z.string(),
  fontSize: z.number().min(12).max(400),
  fontFamily: z.string(),
  fontWeight: z.number().min(100).max(900),
  color: z.string(),
  fromX: z.number().min(-50).max(150),
  fromY: z.number().min(-50).max(150),
  toX: z.number().min(-50).max(150),
  toY: z.number().min(-50).max(150),
  lagInFrames: z.number().min(1).max(20),
  layers: z.number().min(1).max(12),
  trailOpacity: z.number().min(0).max(1),
  useSpring: z.boolean(),
  damping: z.number().min(1).max(50),
  stiffness: z.number().min(1).max(500),
  mass: z.number().min(0.1).max(10),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  text: "FAST",
  fontSize: 180,
  fontFamily: "'Helvetica Neue', Helvetica, Inter, system-ui, sans-serif",
  fontWeight: 900,
  color: "#ffffff",
  fromX: -20,
  fromY: 50,
  toX: 120,
  toY: 50,
  lagInFrames: 4,
  layers: 6,
  trailOpacity: 0.5,
  useSpring: true,
  damping: 20,
  stiffness: 120,
  mass: 1,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element }) => {
  const {
    text,
    fontSize,
    fontFamily,
    fontWeight,
    color,
    fromX,
    fromY,
    toX,
    toY,
    lagInFrames,
    layers,
    trailOpacity,
    useSpring,
    damping,
    stiffness,
    mass,
  } = element.props;

  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const progress = useSpring
    ? spring({
        frame,
        fps,
        config: { damping, stiffness, mass },
        durationInFrames,
      })
    : interpolate(frame, [0, durationInFrames], [0, 1], {
        extrapolateRight: "clamp",
      });

  const x = fromX + (toX - fromX) * progress;
  const y = fromY + (toY - fromY) * progress;

  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      <Trail lagInFrames={lagInFrames} layers={layers} trailOpacity={trailOpacity}>
        <AbsoluteFill
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: `${x}%`,
              top: `${y}%`,
              transform: "translate(-50%, -50%)",
              fontFamily,
              fontSize,
              fontWeight,
              color,
              whiteSpace: "pre",
              textTransform: "uppercase",
              lineHeight: 1,
            }}
          >
            {text}
          </div>
        </AbsoluteFill>
      </Trail>
    </AbsoluteFill>
  );
};

const MotionBlurTextModule: ElementModule<Props> = {
  id: "overlay.motionBlurText",
  category: "overlay",
  label: "Motion-Blur Text",
  description: "Text swept across the frame with a procedural motion-blur trail.",
  defaultDurationSec: 1.2,
  defaultTrack: 0,
  schema,
  defaults,
  Renderer,
};

export default MotionBlurTextModule;
export { MotionBlurTextModule };
