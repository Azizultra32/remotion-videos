// src/hooks/usePlaybackSync.ts
import { useEffect } from "react";
import { useEditorStore } from "../store";

export const usePlaybackSync = () => {
  const { isPlaying, setCurrentTime, fps, compositionDuration, setPlaying } = useEditorStore();

  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setCurrentTime((t) => {
        const next = t + 1 / fps;
        if (next >= compositionDuration) {
          // End of composition: clamp + stop so the interval clears.
          setPlaying(false);
          return compositionDuration;
        }
        return next;
      });
    }, 1000 / fps);

    return () => clearInterval(interval);
  }, [isPlaying, fps, compositionDuration, setCurrentTime, setPlaying]);
};
