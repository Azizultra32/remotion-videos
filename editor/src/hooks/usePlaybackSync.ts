// src/hooks/usePlaybackSync.ts
import { useEffect } from "react";
import { useEditorStore } from "../store";

export const usePlaybackSync = () => {
  const { isPlaying, setCurrentTime, fps, compositionDuration } = useEditorStore();

  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setCurrentTime((t) => {
        const next = t + 1 / fps;
        return next >= compositionDuration ? compositionDuration : next;
      });
    }, 1000 / fps);

    return () => clearInterval(interval);
  }, [isPlaying, fps, compositionDuration, setCurrentTime]);
};
