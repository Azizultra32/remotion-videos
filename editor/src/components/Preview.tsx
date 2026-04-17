// src/components/Preview.tsx
import { Player, PlayerRef } from "@remotion/player";
import { useRef, useEffect, useCallback, useMemo } from "react";
import { useEditorStore } from "../store";
import { PublicCut, defaultPublicCutProps } from "@compositions/PublicCut";
import { buildProps } from "../utils/propsBuilder";

export const Preview = () => {
  const playerRef = useRef<PlayerRef>(null);
  const { currentTimeSec, fps, isPlaying, setCurrentTime, elements, compositionDuration } =
    useEditorStore();

  const inputProps = useMemo(
    () => buildProps(elements, defaultPublicCutProps),
    [elements],
  );

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
      inputProps={inputProps}
      compositionWidth={848}
      compositionHeight={480}
      fps={fps}
      durationInFrames={Math.round(compositionDuration * fps)}
      controls={false}
      style={{ width: "100%", maxHeight: "100%" }}
      clickToPlay={false}
    />
  );
};
