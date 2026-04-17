import React from "react";
import {
  AbsoluteFill,
  Audio,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { z } from "zod";
import { useBeats } from "../hooks/useBeats";
import { ELEMENT_REGISTRY } from "./elements/registry";
import type { RenderCtx, TimelineElement } from "./elements/types";

export const musicVideoSchema = z.object({
  audioSrc: z.string().nullable(),
  beatsSrc: z.string().nullable(),
  backgroundColor: z.string().default("#000000"),
  elements: z.array(z.any()).default([]),
});

export type MusicVideoProps = {
  audioSrc: string | null;
  beatsSrc: string | null;
  backgroundColor: string;
  elements: TimelineElement[];
};

const isActive = (el: TimelineElement, t: number): boolean =>
  t >= el.startSec && t < el.startSec + el.durationSec;

export const MusicVideo: React.FC<MusicVideoProps> = ({
  audioSrc,
  beatsSrc,
  backgroundColor,
  elements,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const absTimeSec = frame / fps;

  const beats = useBeats(beatsSrc);

  const sorted = [...elements].sort(
    (a, b) => (a.trackIndex ?? 0) - (b.trackIndex ?? 0),
  );

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {audioSrc && <Audio src={audioSrc.startsWith("http") || audioSrc.startsWith("/") ? audioSrc : staticFile(audioSrc)} />}

      {sorted.map((el) => {
        if (!isActive(el, absTimeSec)) return null;
        const mod = ELEMENT_REGISTRY[el.type];
        if (!mod) {
          if (process.env.NODE_ENV !== "production") {
            console.warn(`[MusicVideo] unknown element type: ${el.type}`);
          }
          return null;
        }
        const elementLocalSec = absTimeSec - el.startSec;
        const elementProgress = Math.max(
          0,
          Math.min(1, elementLocalSec / Math.max(0.0001, el.durationSec)),
        );
        const ctx: RenderCtx = {
          audioSrc,
          beatsSrc,
          beats,
          width,
          height,
          fps,
          frame,
          absTimeSec,
          elementLocalSec,
          elementProgress,
        };
        const Renderer = mod.Renderer;
        return <Renderer key={el.id} element={el as any} ctx={ctx} />;
      })}
    </AbsoluteFill>
  );
};

export const defaultMusicVideoProps: MusicVideoProps = {
  audioSrc: "dubfire-sake-audio.mp3",
  beatsSrc: "dubfire-beats.json",
  backgroundColor: "#000000",
  elements: [],
};
