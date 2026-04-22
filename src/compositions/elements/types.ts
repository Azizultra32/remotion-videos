import type { FC } from "react";
import type { z } from "zod";
import type { BeatsAPI } from "../../hooks/useBeats";
import type { EventMark } from "../../utils/events";

export type ElementCategory = "text" | "audio" | "shape" | "overlay" | "video";

export type TimelineElement = {
  id: string;
  type: string;
  trackIndex: number;
  startSec: number;
  durationSec: number;
  label: string;
  props: Record<string, unknown>;
  // Optional anchor to a named time event. When set and the event exists,
  // the element's render-time start is the event's timeSec (via
  // resolveStartSec). Absent or missing-event falls back to startSec so
  // events.json deletes can't hide the element.
  startEvent?: string;
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
  // Named time events (MC-style waitUntil pattern). Elements that want to
  // anchor behavior to a named moment resolve via resolveEvent(events, name,
  // fallbackSec) from ../../utils/events. Empty array in tests + renders
  // where events.json is absent.
  events: EventMark[];
  // Asset registry for resolving asset IDs to paths. Null in CLI renders
  // (mv-render pre-resolves), populated in editor preview.
  assetRegistry: Array<{ id: string; path: string; aliases?: string[] }> | null;
};

export type ElementRendererProps<P = Record<string, unknown>> = {
  element: TimelineElement & { props: P };
  ctx: RenderCtx;
};

export type ElementControlsProps<P = Record<string, unknown>> = {
  element: TimelineElement & { props: P };
  updateProps: (partial: Partial<P>) => void;
};

export type MediaFieldKind = "image" | "video" | "gif";
export type MediaFieldRole = "source" | "collection";

export type MediaFieldDefinition = {
  name: string;
  kind: MediaFieldKind;
  multi?: boolean;
  label?: string;
  role?: MediaFieldRole;
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
  mediaFields?: MediaFieldDefinition[];
  Renderer: FC<ElementRendererProps<P>>;
  Controls?: FC<ElementControlsProps<P>>;
};
