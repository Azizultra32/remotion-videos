import { Gif } from "@remotion/gif";
import type { CSSProperties } from "react";
import { Img, OffthreadVideo } from "remotion";
import { getFillMediaStyle } from "./mediaRuntime";

export type GifLoopBehavior = "loop" | "pause-after-finish" | "unmount-after-finish";
export type MediaClipFit = "cover" | "contain" | "fill";

export type MediaClipSource =
  | {
      kind: "image";
      src: string;
    }
  | {
      kind: "gif";
      src: string;
      playbackRate: number;
      loopBehavior: GifLoopBehavior;
    }
  | {
      kind: "video";
      src: string;
      startFromFrame?: number;
      playbackRate?: number;
      muted?: boolean;
      volume?: number;
    };

type MediaClipProps = {
  source: MediaClipSource;
  fit?: MediaClipFit;
  style?: CSSProperties;
};

export const MediaClip = ({ source, fit, style }: MediaClipProps) => {
  if (source.kind === "image") {
    return <Img src={source.src} style={{ ...getFillMediaStyle(fit), ...style }} />;
  }

  if (source.kind === "gif") {
    return (
      <Gif
        src={source.src}
        fit={fit}
        playbackRate={source.playbackRate}
        loopBehavior={source.loopBehavior}
        style={{ ...getFillMediaStyle(), ...style }}
      />
    );
  }

  return (
    <OffthreadVideo
      src={source.src}
      muted={source.muted}
      volume={source.volume}
      playbackRate={source.playbackRate}
      startFrom={source.startFromFrame}
      style={{ ...getFillMediaStyle(fit), ...style }}
    />
  );
};
