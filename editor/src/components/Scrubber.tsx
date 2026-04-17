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

const LABEL_LANE_HEIGHT = 18;

// Chip label rendered in the lane above the waveform. Positioned by
// percentage so label centers land on their marker. transform:
// translateX(-50%) keeps short labels centered and wider labels
// (e.g. D12) from pulling off the right edge.
const Chip = ({
  leftPct,
  bg,
  fg,
  label,
  title,
}: {
  leftPct: number;
  bg: string;
  fg: string;
  label: string;
  title: string;
}) => (
  <span
    title={title}
    style={{
      position: "absolute",
      top: 2,
      left: `${leftPct}%`,
      transform: "translateX(-50%)",
      padding: "1px 5px",
      fontSize: 9,
      fontWeight: 700,
      color: fg,
      background: bg,
      borderRadius: 2,
      letterSpacing: "0.04em",
      whiteSpace: "nowrap",
      pointerEvents: "auto",
      zIndex: 2,
    }}
  >
    {label}
  </span>
);

export const Scrubber = ({ audioUrl, height = 72 }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [ready, setReady] = useState(false);
  const [duration, setDuration] = useState(0);

  // Granular selectors — only re-render when THESE specific fields change.
  // currentTimeSec is deliberately NOT subscribed as state: it changes 24 Hz
  // during playback, and if the whole component re-rendered on every frame
  // the 130-element SVG overlay + wavesurfer.setTime call would starve the
  // main thread and make Pause feel broken. Same fix Preview got in 83d932b.
  //
  // Instead we subscribe imperatively: a ref-based listener moves the
  // playhead div via `element.style.left` and calls `ws.setTime`, bypassing
  // React reconciliation entirely. React only re-renders when beatData,
  // duration, audioSrc, etc. change — which happens rarely.
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const beatData = useEditorStore((s) => s.beatData);
  const compositionDuration = useEditorStore((s) => s.compositionDuration);
  const audioSrc = useEditorStore((s) => s.audioSrc);
  const playheadRef = useRef<HTMLDivElement>(null);

  const trackName = audioSrc
    ? audioSrc
        .replace(/^.*\//, "")
        .replace(/\.[^.]+$/, "")
        .replace(/[-_]+/g, " ")
    : null;

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
      // Kill wavesurfer's playback path entirely. We only want the waveform
      // render — playback is owned by the Remotion Player. Merely muting the
      // element isn't enough: HMR can leak detached audio elements that keep
      // playing after unmount (that's the "mashed noise after closing the
      // tab" symptom). Stripping src + pause is the reliable kill.
      try {
        ws.setVolume(0);
      } catch {}
      try {
        (ws as any).stop?.();
      } catch {}
      const media = ws.getMediaElement?.();
      if (media) {
        media.muted = true;
        media.pause();
        media.removeAttribute("src");
        media.load();
      }
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
  // either doubles up or (more often) kills both.
  //
  // Imperative playhead + wavesurfer sync: subscribe directly to the store,
  // move the playhead DOM node via inline style, and call ws.setTime. No
  // React re-render per frame. This is the hot path during playback; doing
  // it via useState/useEffect re-renders was the root cause of the pause bug.
  useEffect(() => {
    if (!ready || !duration) return;
    const update = (t: number) => {
      const el = playheadRef.current;
      if (el) {
        const pct = Math.min(100, Math.max(0, (t / duration) * 100));
        el.style.left = `${pct}%`;
      }
      const ws = wsRef.current;
      if (ws && typeof (ws as any).setTime === "function") {
        try {
          (ws as any).setTime(t);
        } catch {
          // wavesurfer can throw after unmount or src removal; harmless.
        }
      }
    };
    // Paint initial position before the first store tick.
    update(useEditorStore.getState().currentTimeSec);
    // Listen for subsequent changes without re-rendering the component.
    return useEditorStore.subscribe((state, prev) => {
      if (state.currentTimeSec !== prev.currentTimeSec) {
        update(state.currentTimeSec);
      }
    });
  }, [ready, duration]);

  const totalSec = duration || compositionDuration || 1;

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
        <span style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Waveform{trackName ? ` — ${trackName}` : ""}
        </span>
        <span>
          {beatData
            ? `${beatData.beats.length} beats · ${beatData.drops.length} drops · ${beatData.bpm_global.toFixed(1)} bpm`
            : "loading beats…"}
        </span>
      </div>

      {/* Dedicated label lane above the waveform. All chips (D/B/U) live
          here instead of floating inside the wave. This keeps the audio
          shape legible and leaves the marker lines as pure pointers that
          bridge the lane to the wave below. Research basis: SoundCloud,
          Audacity, iZotope RX all use an above-or-below lane rather than
          in-wave labels. */}
      {ready && beatData && (
        <div
          style={{
            position: "relative",
            width: "100%",
            height: LABEL_LANE_HEIGHT,
            marginBottom: 2,
          }}
        >
          {beatData.breakdowns.map((b, i) => {
            const leftPct = ((b.start + b.end) / 2 / totalSec) * 100;
            return (
              <Chip
                key={`lbl-bd${i}`}
                leftPct={leftPct}
                bg="#7ab8ff"
                fg="#0a1628"
                label={`B${i + 1}`}
                title={`Breakdown ${i + 1}: ${b.start.toFixed(1)}s → ${b.end.toFixed(1)}s`}
              />
            );
          })}
          {(beatData.buildups ?? []).map((b, i) => {
            const leftPct = ((b.start + b.end) / 2 / totalSec) * 100;
            return (
              <Chip
                key={`lbl-bu${i}`}
                leftPct={leftPct}
                bg="#ffb86b"
                fg="#1a1000"
                label={`U${i + 1}`}
                title={`Buildup ${i + 1}: ${b.start.toFixed(1)}s → ${b.end.toFixed(1)}s`}
              />
            );
          })}
          {beatData.drops.map((t, i) => {
            const leftPct = (t / totalSec) * 100;
            const mm = Math.floor(t / 60);
            const ss = (t - mm * 60).toFixed(1);
            return (
              <Chip
                key={`lbl-drop${i}`}
                leftPct={leftPct}
                bg="#ff3838"
                fg="#fff"
                label={`D${i + 1}`}
                title={`Drop ${i + 1} @ ${mm}:${ss}`}
              />
            );
          })}
        </div>
      )}

      <div style={{ position: "relative", width: "100%", height }}>
        <div ref={containerRef} style={{ width: "100%", height }} />

        {/* Overlays in the waveform area: region fills (SVG) + region
            borders + drop vertical lines. Labels live in the lane above. */}
        {ready && beatData && (
          <>
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
              {beatData.breakdowns.map((b, i) => (
                <rect
                  key={`bd${i}`}
                  x={b.start}
                  width={Math.max(0.01, b.end - b.start)}
                  y={0}
                  height={100}
                  fill="rgba(122,184,255,0.12)"
                />
              ))}
              {(beatData.buildups ?? []).map((b, i) => (
                <rect
                  key={`bu${i}`}
                  x={b.start}
                  width={Math.max(0.01, b.end - b.start)}
                  y={0}
                  height={100}
                  fill="rgba(255,184,107,0.10)"
                />
              ))}
            </svg>
            {beatData.breakdowns.map((b, i) => {
              const leftPct = (b.start / totalSec) * 100;
              const widthPct = Math.max(0.5, ((b.end - b.start) / totalSec) * 100);
              return (
                <div
                  key={`bdl${i}`}
                  style={{
                    position: "absolute",
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    top: 0,
                    height: "100%",
                    pointerEvents: "none",
                    borderTop: "1px solid rgba(122,184,255,0.55)",
                    borderBottom: "1px solid rgba(122,184,255,0.55)",
                  }}
                />
              );
            })}
            {(beatData.buildups ?? []).map((b, i) => {
              const leftPct = (b.start / totalSec) * 100;
              const widthPct = Math.max(0.5, ((b.end - b.start) / totalSec) * 100);
              return (
                <div
                  key={`bul${i}`}
                  style={{
                    position: "absolute",
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    top: 0,
                    height: "100%",
                    pointerEvents: "none",
                    borderLeft: "1.5px dashed rgba(255,184,107,0.6)",
                    borderRight: "1.5px dashed rgba(255,184,107,0.6)",
                  }}
                />
              );
            })}
            {beatData.drops.map((t, i) => {
              const leftPct = (t / totalSec) * 100;
              const mm = Math.floor(t / 60);
              const ss = (t - mm * 60).toFixed(1);
              return (
                <div
                  key={`drop${i}`}
                  style={{
                    position: "absolute",
                    left: `${leftPct}%`,
                    top: 0,
                    bottom: 0,
                    width: 2,
                    background: "#ff6b7a",
                    boxShadow: "0 0 4px rgba(255,107,122,0.8)",
                    transform: "translateX(-1px)",
                    pointerEvents: "none",
                  }}
                  title={`Drop ${i + 1} @ ${mm}:${ss}`}
                />
              );
            })}
          </>
        )}

        {/* Playhead — canonical store time. `left` is set imperatively by
            the subscribe hook above so this component does NOT re-render
            on every frame. */}
        <div
          ref={playheadRef}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: "0%",
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

    </div>
  );
};
