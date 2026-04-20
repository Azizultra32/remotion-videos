import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { useBeats } from "../hooks/useBeats";
import { type EventMark, resolveStartSec } from "../utils/events";
import { ELEMENT_REGISTRY } from "./elements/registry";
import type { ElementRendererProps, RenderCtx, TimelineElement } from "./elements/types";

// Per-element error boundary. One broken element module — custom or
// built-in — can't take down the render or the editor preview. It just
// logs, returns null for that element, and keeps the rest of the
// composition rendering.
type SafeRenderProps = {
  elementId: string;
  elementType: string;
  // biome-ignore lint/suspicious/noExplicitAny: Renderer is heterogeneous across element types
  Renderer: React.FC<ElementRendererProps<any>>;
  // biome-ignore lint/suspicious/noExplicitAny: element's P is erased at dispatch
  element: ElementRendererProps<any>["element"];
  ctx: RenderCtx;
};
class SafeElement extends React.Component<
  SafeRenderProps,
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    // eslint-disable-next-line no-console
    console.warn(
      `[MusicVideo] element ${this.props.elementId} (${this.props.elementType}) threw: ${err.message}`,
    );
  }
  render() {
    if (this.state.hasError) return null;
    const { Renderer, element, ctx } = this.props;
    return <Renderer element={element} ctx={ctx} />;
  }
}

export const musicVideoSchema = z.object({
  audioSrc: z.string().nullable(),
  beatsSrc: z.string().nullable(),
  backgroundColor: z.string().default("#000000"),
  elements: z.array(z.any()).default([]),
  // Named time events (MC-style waitUntil pattern). Authored in the editor
  // (cyan pills on the waveform) and persisted to projects/<stem>/events.json.
  // Elements resolve these via ctx.events at render time.
  events: z.array(z.object({ name: z.string(), timeSec: z.number() })).default([]),
  // When true, suppress the internal <Audio> tag but still expose audioSrc
  // to elements via RenderCtx so audio-reactive visualizers (FFT, waveform)
  // keep working. Used by the editor preview, which owns audio playback
  // via its own <audio> element.
  muteAudioTag: z.boolean().default(false),
  // Optional override: URL that analysis hooks (useFFT, useWindowedAudioData)
  // should fetch from. Falls back to audioSrc when not set. Lets the editor
  // pass the real audio URL to visualizers even when audioSrc is null.
  analysisAudioSrc: z.string().nullable().default(null),
});

export type MusicVideoProps = {
  audioSrc: string | null;
  beatsSrc: string | null;
  backgroundColor: string;
  elements: TimelineElement[];
  events?: EventMark[];
  muteAudioTag?: boolean;
  analysisAudioSrc?: string | null;
};

const isActive = (el: TimelineElement, t: number, events: EventMark[]): boolean => {
  const start = resolveStartSec(el, events);
  return t >= start && t < start + el.durationSec;
};

export const MusicVideo: React.FC<MusicVideoProps> = ({
  audioSrc,
  beatsSrc,
  backgroundColor,
  elements,
  events = [],
  muteAudioTag = false,
  analysisAudioSrc = null,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const absTimeSec = frame / fps;

  const beats = useBeats(beatsSrc);

  const sorted = [...elements].sort((a, b) => (a.trackIndex ?? 0) - (b.trackIndex ?? 0));

  // audioSrc that audio-reactive elements see via RenderCtx. Prefer an
  // explicit override (editor preview passes the real URL here while
  // keeping audioSrc=null to silence <Audio>), otherwise use audioSrc.
  const ctxAudioSrc = analysisAudioSrc ?? audioSrc;

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {audioSrc && !muteAudioTag && (
        <Audio
          src={
            audioSrc.startsWith("http") || audioSrc.startsWith("/")
              ? audioSrc
              : staticFile(audioSrc)
          }
        />
      )}

      {sorted.map((el) => {
        if (!isActive(el, absTimeSec, events)) return null;
        const mod = ELEMENT_REGISTRY[el.type];
        if (!mod) {
          if (process.env.NODE_ENV !== "production") {
            console.warn(`[MusicVideo] unknown element type: ${el.type}`);
          }
          return null;
        }
        const effectiveStart = resolveStartSec(el, events);
        const elementLocalSec = absTimeSec - effectiveStart;
        const elementProgress = Math.max(
          0,
          Math.min(1, elementLocalSec / Math.max(0.0001, el.durationSec)),
        );
        const ctx: RenderCtx = {
          audioSrc: ctxAudioSrc,
          beatsSrc,
          beats,
          width,
          height,
          fps,
          frame,
          absTimeSec,
          elementLocalSec,
          elementProgress,
          events,
        };
        const Renderer = mod.Renderer;
        // Per-element ErrorBoundary — a broken custom element can't brick
        // the whole render. See SafeElement above. `el` loses its prop
        // discriminant at registry dispatch; cast through as the union.
        return (
          <SafeElement
            key={el.id}
            elementId={el.id}
            elementType={el.type}
            Renderer={Renderer}
            element={el as unknown as Parameters<typeof Renderer>[0]["element"]}
            ctx={ctx}
          />
        );
      })}
    </AbsoluteFill>
  );
};

export const defaultMusicVideoProps: MusicVideoProps = {
  audioSrc: "love-in-traffic.mp3",
  beatsSrc: "love-in-traffic-beats.json",
  backgroundColor: "#000000",
  elements: [],
  events: [],
};
