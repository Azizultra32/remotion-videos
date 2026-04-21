import type React from "react";
import { AbsoluteFill, interpolate, spring } from "remotion";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { flip } from "@remotion/transitions/flip";
import { iris } from "@remotion/transitions/iris";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import type { TransitionPresentation } from "@remotion/transitions";
import { z } from "zod";
import type { ElementModule, ElementRendererProps } from "../types";

// Full-screen transition effect — fade / slide / wipe / flip / iris /
// clockWipe — rendered as a standalone overlay on its own time range
// instead of wrapping two sibling scenes (which doesn't fit our
// one-element-per-timerange model).
//
// Mechanics: a solid fill (the "exiting" scene) is wrapped in the chosen
// presentation component with `presentationProgress` manually driven from
// 0..1 across the element's duration. The result is an exiting-side
// animation (fade-to-color, wipe-off, iris-close, etc.) that reveals
// whatever siblings are rendered beneath on the timeline.
//
// Deterministic: at any frame the pixel is a pure function of the element's
// local time, preset, and direction. Spring timing is optional.

const schema = z.object({
  preset: z.enum(["fade", "slide", "wipe", "flip", "iris", "clockWipe"]),
  direction: z.enum([
    "from-left",
    "from-right",
    "from-top",
    "from-bottom",
    "from-top-left",
    "from-top-right",
    "from-bottom-left",
    "from-bottom-right",
  ]),
  fillColor: z.string(),
  fillMode: z.enum(["solid", "transparent"]),
  timing: z.enum(["linear", "spring"]),
  // Spring config (only used when timing==="spring"). Visualized by
  // ElementDetail's SpringCurveVisualizer — no duplicate inputs.
  damping: z.number().min(1).max(50),
  mass: z.number().min(0.1).max(10),
  stiffness: z.number().min(1).max(500),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  preset: "fade",
  direction: "from-left",
  fillColor: "#000000",
  fillMode: "solid",
  timing: "linear",
  damping: 200,
  mass: 1,
  stiffness: 100,
};

type Presentation = TransitionPresentation<Record<string, unknown>>;

// Slide / flip are strict 4-way; map the 8-way wipe set onto the nearest 4-way
// so the direction picker stays a single dropdown across all presets.
type FourDir = "from-left" | "from-right" | "from-top" | "from-bottom";
const TO_FOUR: Record<Props["direction"], FourDir> = {
  "from-left": "from-left",
  "from-right": "from-right",
  "from-top": "from-top",
  "from-bottom": "from-bottom",
  "from-top-left": "from-left",
  "from-top-right": "from-right",
  "from-bottom-left": "from-left",
  "from-bottom-right": "from-right",
};

// iris/clockWipe need the compositing canvas dimensions. Passed from the
// Renderer via useVideoConfig — we don't know them at module load time.
const buildPresentation = (
  preset: Props["preset"],
  direction: Props["direction"],
  width: number,
  height: number,
): Presentation => {
  switch (preset) {
    case "fade":
      return fade() as unknown as Presentation;
    case "slide":
      return slide({ direction: TO_FOUR[direction] }) as unknown as Presentation;
    case "wipe":
      return wipe({ direction }) as unknown as Presentation;
    case "flip":
      return flip({ direction: TO_FOUR[direction] }) as unknown as Presentation;
    case "iris":
      return iris({ width, height }) as unknown as Presentation;
    case "clockWipe":
      return clockWipe({ width, height }) as unknown as Presentation;
  }
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { preset, direction, fillColor, fillMode, timing, damping, mass, stiffness } =
    element.props;

  // RenderCtx carries element-local time; MusicVideo doesn't wrap
  // elements in <Sequence>, so useCurrentFrame() here would give the
  // composition-absolute frame which is the whole song long — using
  // that for progress would make the transition never advance.
  const { fps, width, height } = ctx;
  const elementFrames = Math.max(1, Math.round(element.durationSec * fps));
  const frame = Math.max(0, Math.min(elementFrames - 1, Math.round(ctx.elementLocalSec * fps)));
  const progress =
    timing === "spring"
      ? spring({
          frame,
          fps,
          config: { damping, mass, stiffness },
          durationInFrames: elementFrames,
        })
      : interpolate(frame, [0, elementFrames - 1], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

  const presentation = buildPresentation(preset, direction, width, height);
  const Component = presentation.component as React.ComponentType<{
    presentationProgress: number;
    presentationDirection: "entering" | "exiting";
    passedProps: Record<string, unknown>;
    presentationDurationInFrames: number;
    children: React.ReactNode;
  }>;

  const fill =
    fillMode === "solid" ? (
      <AbsoluteFill style={{ background: fillColor }} />
    ) : (
      <AbsoluteFill />
    );

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <Component
        presentationProgress={progress}
        presentationDirection="exiting"
        passedProps={presentation.props}
        presentationDurationInFrames={elementFrames}
      >
        {fill}
      </Component>
    </AbsoluteFill>
  );
};

const SceneTransitionModule: ElementModule<Props> = {
  id: "overlay.sceneTransition",
  category: "overlay",
  label: "Scene Transition",
  description:
    "Full-screen transition effect (fade / slide / wipe / flip / iris / clock-wipe).",
  defaultDurationSec: 0.8,
  defaultTrack: 6,
  schema,
  defaults,
  Renderer,
};

export default SceneTransitionModule;
export { SceneTransitionModule };
