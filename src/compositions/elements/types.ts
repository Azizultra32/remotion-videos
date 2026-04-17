import type { FC } from "react";
import type { z } from "zod";
import type { BeatsAPI } from "../../hooks/useBeats";

export type ElementCategory = "text" | "audio" | "shape" | "overlay" | "video";

export type TimelineElement = {
  id: string;
  type: string;
  trackIndex: number;
  startSec: number;
  durationSec: number;
  label: string;
  props: Record<string, unknown>;
};

export type RenderCtx = {
  audioSrc: string | null;
  beatsSrc: string | null;
  beats: BeatsAPI;
  width: number;
  height: number;
  fps: number;
  frame: number;
  absTimeSec: number;
  elementLocalSec: number;
  elementProgress: number;
};

export type ElementRendererProps<P = Record<string, unknown>> = {
  element: TimelineElement & { props: P };
  ctx: RenderCtx;
};

export type ElementControlsProps<P = Record<string, unknown>> = {
  element: TimelineElement & { props: P };
  updateProps: (partial: Partial<P>) => void;
};

export type ElementModule<P = Record<string, unknown>> = {
  id: string;
  category: ElementCategory;
  label: string;
  description: string;
  defaultDurationSec: number;
  defaultTrack: number;
  schema: z.ZodType<P>;
  defaults: P;
  Renderer: FC<ElementRendererProps<P>>;
  Controls?: FC<ElementControlsProps<P>>;
};
