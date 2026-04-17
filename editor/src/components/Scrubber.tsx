// src/components/Scrubber.tsx
// A click-to-seek waveform with beat/drop/breakdown overlays and a live
// playhead. Replaces the old SpectrumDisplay (bass-bar readout) which
// wasn't actually interactive.
import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { useEditorStore } from "../store";

type Props = {
  audioUrl: string;
  height?: number;
};

export const Scrubber = ({ audioUrl, height = 72 }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [ready, setReady] = useState(false);
  const [duration, setDuration] = useState(0);

  const {
    currentTimeSec,
    setCurrentTime,
    beatData,
    compositionDuration,
    isPlaying,
    setPlaying,
  } = useEditorStore();

  useEffect(() => {
    if (!containerRef.current) return;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#3a3a3a",
      progressColor: "#6aa6ff",
      cursorColor: "transparent", // we draw our own playhead on top
      height,
      barWidth: 2,
      barGap: 1,
      normalize: true,
      interact: true,
    });
    ws.load(audioUrl);
    ws.on("ready", () => {
      setReady(true);
      const d = ws.getDuration();
      setDuration(d);
      // Always defer to the actual decoded audio length. Prevents a stale
      // (persisted or default) value from clamping seeks past its bound.
      if (d) {
        useEditorStore.setState({ compositionDuration: Math.ceil(d) });
      }
      // Hard-mute wavesurfer's own MediaElement — we only use its waveform
      // rendering, playback is owned by the Remotion Player. Without this
      // both audio paths fight and nothing audible comes out.
      try {
        ws.setVolume(0);
      } catch {
        /* older wavesurfer — fall back to muting the underlying element */
      }
      const media = ws.getMediaElement?.();
      if (media) media.muted = true;
    });
    ws.on("click", (progress: number) => {
      const t = progress * ws.getDuration();
      setCurrentTime(t);
    });
    wsRef.current = ws;
    return () => {
      ws.destroy();
      wsRef.current = null;
      setReady(false);
    };
  }, [audioUrl, height, setCurrentTime]);

  // Do NOT call ws.play()/pause() here. WaveSurfer's internal MediaElement
  // would play its own audio in parallel with the Remotion Player, which
  // either doubles up or (more often) kills both. The progress fill is
  // already driven by the `setTime` effect below, which is sufficient.

  // Keep wavesurfer's playhead in sync with the canonical store time.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !ready || !duration) return;
    const progress = Math.min(1, Math.max(0, currentTimeSec / duration));
    // setTime is gentler than seekTo and won't restart playback.
    if (typeof (ws as any).setTime === "function") {
      (ws as any).setTime(currentTimeSec);
    } else {
      ws.seekTo(progress);
    }
  }, [currentTimeSec, ready, duration]);

  const totalSec = duration || compositionDuration || 1;
  const playheadPct = Math.min(100, Math.max(0, (currentTimeSec / totalSec) * 100));

  return (
    <div
      style={{
        padding: "6px 16px 8px",
        borderBottom: "1px solid #333",
        background: "#0a0a0a",
        position: "relative",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "#888",
          marginBottom: 4,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>
          Waveform — click to seek · space: play/pause · ← → step 1s · shift+← → 5s
        </span>
        <span>
          {beatData
            ? `${beatData.beats.length} beats · ${beatData.drops.length} drops · ${beatData.bpm_global.toFixed(1)} bpm`
            : "loading beats…"}
        </span>
      </div>

      <div style={{ position: "relative", width: "100%", height }}>
        <div ref={containerRef} style={{ width: "100%", height }} />

        {/* Overlays drawn in the same coordinate space as the waveform */}
        {ready && beatData && (
          <svg
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
            preserveAspectRatio="none"
            viewBox={`0 0 ${totalSec} 100`}
          >
            {/* Breakdown regions */}
            {beatData.breakdowns.map((b, i) => (
              <rect
                key={`bd${i}`}
                x={b.start}
                width={Math.max(0.01, b.end - b.start)}
                y={0}
                height={100}
                fill="rgba(255,80,80,0.08)"
              />
            ))}
            {/* Drop markers */}
            {beatData.drops.map((t, i) => (
              <line
                key={`d${i}`}
                x1={t}
                x2={t}
                y1={0}
                y2={100}
                stroke="#ff4444"
                strokeWidth={0.15}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        )}

        {/* Playhead — canonical store time, not wavesurfer's */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${playheadPct}%`,
            width: 2,
            background: "#fff",
            boxShadow: "0 0 4px rgba(255,255,255,0.8)",
            pointerEvents: "none",
            transform: "translateX(-1px)",
          }}
        />
      </div>

      {/* Fallback transport while wavesurfer is loading */}
      {!ready && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#666",
            fontSize: 11,
            pointerEvents: "none",
          }}
        >
          decoding audio…
        </div>
      )}

      {/* Tap anywhere to pause — convenience when waveform is hidden by overlay */}
      <div
        onClick={() => setPlaying(!isPlaying)}
        style={{ display: "none" }}
      />
    </div>
  );
};
