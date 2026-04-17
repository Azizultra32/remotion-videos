// src/components/Preview.tsx
import { Player, PlayerRef } from "@remotion/player";
import { useRef, useEffect, useCallback, useMemo } from "react";
import { useEditorStore } from "../store";
import { MusicVideo, defaultMusicVideoProps } from "@compositions/MusicVideo";

export const Preview = () => {
  const playerRef = useRef<PlayerRef>(null);
  const {
    currentTimeSec,
    fps,
    isPlaying,
    setCurrentTime,
    setPlaying,
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

  // Seek when the store time diverges meaningfully from the player's clock.
  // During playback, onFrameUpdate writes currentTimeSec ≈ player frame, so
  // this compare skips those. External writes (scrubber click, snap, Reset)
  // produce a big delta and seek through.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const desired = Math.round(currentTimeSec * fps);
    const actual = player.getCurrentFrame();
    if (Math.abs(desired - actual) > 2) {
      player.seekTo(desired);
    }
  }, [currentTimeSec, fps]);

  // Drive the Player from isPlaying. Kept separate from the event listener
  // below to avoid a loop (the listener writes the store, this reads it).
  // Only acts when the Player disagrees with the store, so a stray event
  // doesn't bounce us back.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (isPlaying && !player.isPlaying()) player.play();
    else if (!isPlaying && player.isPlaying()) player.pause();
  }, [isPlaying]);

  // Mirror the Player's actual state into the store. This is the critical
  // fix for "pause doesn't work": the Player owns playback state, and the
  // store merely reflects it. A Pause click writes false → effect above
  // calls player.pause() → Player fires 'pause' event → store confirms
  // false. If the Player ever pauses on its own (end, error), the UI
  // updates to match instead of lying about its state.
  const onFrameUpdate = useCallback(
    (e: { detail: { frame: number } }) => {
      setCurrentTime(e.detail.frame / fps);
    },
    [fps, setCurrentTime],
  );
  const onPlay = useCallback(() => setPlaying(true), [setPlaying]);
  const onPause = useCallback(() => setPlaying(false), [setPlaying]);
  const onEnded = useCallback(() => setPlaying(false), [setPlaying]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.addEventListener("frameupdate", onFrameUpdate as any);
    player.addEventListener("play", onPlay as any);
    player.addEventListener("pause", onPause as any);
    player.addEventListener("ended", onEnded as any);
    return () => {
      player.removeEventListener("frameupdate", onFrameUpdate as any);
      player.removeEventListener("play", onPlay as any);
      player.removeEventListener("pause", onPause as any);
      player.removeEventListener("ended", onEnded as any);
    };
  }, [onFrameUpdate, onPlay, onPause, onEnded]);

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
