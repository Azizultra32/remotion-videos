// src/components/Preview.tsx
//
// Minimal Remotion Player host. Store is source of truth for isPlaying
// and currentTimeSec; Player is a controlled output. No two-way event
// mirroring — it caused "Maximum update depth" when combined with a
// re-render storm from the destructure-everything subscription pattern.
import { Player, PlayerRef } from "@remotion/player";
import { useRef, useEffect, useCallback, useMemo } from "react";
import { useEditorStore } from "../store";
import { MusicVideo, defaultMusicVideoProps } from "@compositions/MusicVideo";

export const Preview = () => {
  const playerRef = useRef<PlayerRef>(null);

  // Granular selectors. Destructuring the whole store caused this component
  // to re-render on every frameupdate (24 Hz), which cascaded into the
  // Player and bricked pause.
  const fps = useEditorStore((s) => s.fps);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const elements = useEditorStore((s) => s.elements);
  const compositionDuration = useEditorStore((s) => s.compositionDuration);
  const loopPlayback = useEditorStore((s) => s.loopPlayback);
  const audioSrc = useEditorStore((s) => s.audioSrc);
  const beatsSrc = useEditorStore((s) => s.beatsSrc);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);

  const inputProps = useMemo(
    () => ({
      ...defaultMusicVideoProps,
      audioSrc: audioSrc ?? defaultMusicVideoProps.audioSrc,
      beatsSrc: beatsSrc ?? defaultMusicVideoProps.beatsSrc,
      elements,
    }),
    [audioSrc, beatsSrc, elements],
  );

  // One-way control: store → Player. The store is the source of truth;
  // we never mirror the Player's events back.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (isPlaying) player.play();
    else player.pause();
  }, [isPlaying]);

  // External seeks (scrubber click, snap, Reset) write currentTimeSec; the
  // Player's own frameupdate also writes it. To avoid fighting the Player's
  // clock, we subscribe to currentTimeSec via getState() inside a listener
  // and only seek when the gap is large. This effect runs once.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const unsub = useEditorStore.subscribe((state, prev) => {
      if (state.currentTimeSec === prev.currentTimeSec) return;
      const desired = Math.round(state.currentTimeSec * fps);
      const actual = player.getCurrentFrame();
      if (Math.abs(desired - actual) > 2) {
        player.seekTo(desired);
      }
    });
    return unsub;
  }, [fps]);

  // Player → store: write currentTimeSec on every frame so the scrubber
  // playhead tracks playback. This is the ONLY Player → store path.
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
