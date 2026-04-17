// src/components/Preview.tsx
import { Player, PlayerRef } from "@remotion/player";
import { useRef, useEffect, useCallback } from "react";
import { useEditorStore } from "../store";
import { PublicCut, defaultPublicCutProps } from "@compositions/PublicCut";

export const Preview = () => {
  const playerRef = useRef<PlayerRef>(null);
  const { currentTimeSec, fps, isPlaying, setCurrentTime } = useEditorStore();

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const frame = Math.round(currentTimeSec * fps);
    player.seekTo(frame);
  }, [currentTimeSec, fps]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (isPlaying) player.play();
    else player.pause();
  }, [isPlaying]);

  const onFrameUpdate = useCallback(
    (e: { detail: { frame: number } }) => {
      setCurrentTime(e.detail.frame / fps);
    },
    [fps, setCurrentTime],
  );

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.addEventListener("frameupdate", onFrameUpdate as any);
    return () => player.removeEventListener("frameupdate", onFrameUpdate as any);
  }, [onFrameUpdate]);

  return (
    <Player
      ref={playerRef}
      component={PublicCut}
      inputProps={defaultPublicCutProps}
      compositionWidth={848}
      compositionHeight={480}
      fps={fps}
      durationInFrames={Math.round(90 * fps)}
      controls={false}
      style={{ width: "100%", maxHeight: "100%" }}
      clickToPlay={false}
    />
  );
};
