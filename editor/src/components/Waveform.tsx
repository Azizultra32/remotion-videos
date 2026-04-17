// src/components/Waveform.tsx
import { useRef, useEffect } from "react";
import WaveSurfer from "wavesurfer.js";
import { useEditorStore } from "../store";

export const Waveform = ({ audioUrl }: { audioUrl: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const { currentTimeSec, setCurrentTime } = useEditorStore();

  useEffect(() => {
    if (!containerRef.current) return;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#444",
      progressColor: "#888",
      cursorColor: "#fff",
      height: 60,
      barWidth: 2,
      barGap: 1,
      normalize: true,
      interact: true,
    });
    ws.load(audioUrl);
    ws.on("click", (progress: number) => {
      const t = progress * ws.getDuration();
      setCurrentTime(t);
    });
    wsRef.current = ws;
    return () => ws.destroy();
  }, [audioUrl, setCurrentTime]);

  // Sync cursor position from editor state
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !ws.getDuration()) return;
    const progress = currentTimeSec / ws.getDuration();
    ws.seekTo(Math.min(1, Math.max(0, progress)));
  }, [currentTimeSec]);

  return <div ref={containerRef} style={{ width: "100%", height: 60 }} />;
};
