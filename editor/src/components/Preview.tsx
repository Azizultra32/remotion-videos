// src/components/Preview.tsx
import { Player, PlayerRef } from "@remotion/player";
import { useRef, useEffect, useCallback, useMemo } from "react";
import { useEditorStore } from "../store";
import { MusicVideo, defaultMusicVideoProps } from "@compositions/MusicVideo";

export const Preview = () => {
  const playerRef = useRef<PlayerRef>(null);
  const suppressSeekRef = useRef(false);
  const {
    currentTimeSec,
    fps,
    isPlaying,
    setCurrentTime,
    elements,
    compositionDuration,
    loopPlayback,
    audioSrc,
    beatsSrc,
  } = useEditorStore();

  const inputProps = useMemo(
    () => ({
      ...defaultMusicVideoProps,
      audioSrc: audioSrc ?? defaultMusicVideoProps.audioSrc,
      beatsSrc: beatsSrc ?? defaultMusicVideoProps.beatsSrc,
      elements,
    }),
    [audioSrc, beatsSrc, elements],
  );

  // Only seek when the store time came from outside the player (scrubber,
  // snap-to-beat, Reset button). Skip seeks that we just wrote from the
  // player's own frameupdate — those would fight the player's clock and
  // stall playback.
  useEffect(() => {
    if (suppressSeekRef.current) {
      suppressSeekRef.current = false;
      return;
    }
    const player = playerRef.current;
    if (!player) return;
    const desired = Math.round(currentTimeSec * fps);
    const actual = player.getCurrentFrame();
    if (Math.abs(desired - actual) > 1) {
      player.seekTo(desired);
    }
  }, [currentTimeSec, fps]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (isPlaying) player.play();
    else player.pause();
  }, [isPlaying]);

  const onFrameUpdate = useCallback(
    (e: { detail: { frame: number } }) => {
      suppressSeekRef.current = true;
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
      component={MusicVideo}
      inputProps={inputProps as any}
      compositionWidth={848}
      compositionHeight={480}
      fps={fps}
      durationInFrames={Math.round(compositionDuration * fps)}
      controls={false}
      style={{ width: "100%", maxHeight: "100%" }}
      clickToPlay={false}
      loop={loopPlayback}
      errorFallback={({ error }) => (
        <div
          style={{
            padding: 16,
            background: "#2a0000",
            color: "#fff",
            fontSize: 12,
            fontFamily: "monospace",
            width: "100%",
            height: "100%",
            overflow: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          <div style={{ color: "#f66", fontWeight: 600, marginBottom: 8 }}>
            Composition error
          </div>
          {error.message}
          {error.stack && (
            <div style={{ marginTop: 8, color: "#ccc", fontSize: 10 }}>
              {error.stack}
            </div>
          )}
        </div>
      )}
    />
  );
};
