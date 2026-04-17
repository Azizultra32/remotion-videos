// src/hooks/usePlaybackSync.ts
import { useEffect } from "react";
import { useEditorStore } from "../store";

export const usePlaybackSync = () => {
  const {
    isPlaying,
    setCurrentTime,
    fps,
    compositionDuration,
    loopPlayback,
    setPlaying,
  } = useEditorStore();

  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setCurrentTime((t) => {
        const next = t + 1 / fps;
        if (next >= compositionDuration) {
          // End of composition: loop back to 0 or clamp + stop.
          if (loopPlayback) {
            return 0;
          }
          // Clamp to end and stop playback so the interval can clear.
          setPlaying(false);
          return compositionDuration;
        }
        return next;
      });
    }, 1000 / fps);

    return () => clearInterval(interval);
  }, [
    isPlaying,
    fps,
    compositionDuration,
    loopPlayback,
    setCurrentTime,
    setPlaying,
  ]);
};
