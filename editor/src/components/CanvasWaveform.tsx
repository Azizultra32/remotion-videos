// CanvasWaveform — self-contained waveform renderer with no external deps.
// Replaces wavesurfer.js inside Scrubber.tsx per MC deep-dive §3. Pattern
// lifted from motion-canvas packages/core/src/media/AudioResourceManager.ts
// (decode via AudioContext, extract peaks, draw to <canvas>).
//
// v1 scope: full-track waveform, click-to-seek, device-pixel-ratio aware.
// Zoom (§2) comes in a follow-up that threads startSec/endSec props.

import { useEffect, useRef, useState } from "react";
import { extractPeaks, normalizePeaks } from "../utils/audioPeaks";
import { loadCachedPeaks, saveCachedPeaks } from "../utils/peaksCache";

type Props = {
  audioUrl: string;
  height?: number;
  color?: string;
  onReady?: (durationSec: number) => void;
  onSeek?: (sec: number) => void;
};

// Visual tuning. Matches wavesurfer's old `barWidth: 2, barGap: 1` so the
// swap looks identical at a glance.
const BAR_WIDTH = 2;
const BAR_GAP = 1;
// Cap the number of (min,max) pairs we keep in memory. 8192 buckets of
// 1024 samples ≈ 190 s of 44.1 kHz audio; longer tracks get larger buckets
// and stay bounded. Keeps peak extraction under ~30 ms for a 10-min track.
const TARGET_BUCKETS = 8192;

const drawWaveform = (
  canvas: HTMLCanvasElement,
  peaks: Float32Array,
  cssWidth: number,
  cssHeight: number,
  color: string,
) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.max(1, Math.floor(cssWidth * dpr));
  const targetH = Math.max(1, Math.floor(cssHeight * dpr));
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = color;

  const bucketCount = peaks.length / 2;
  if (bucketCount === 0) return;
  const stride = BAR_WIDTH + BAR_GAP;
  const barCount = Math.max(1, Math.floor(cssWidth / stride));
  const midY = cssHeight / 2;
  const halfH = cssHeight / 2;

  for (let i = 0; i < barCount; i++) {
    const bucketIdx = Math.floor((i / barCount) * bucketCount);
    const min = peaks[bucketIdx * 2];
    const max = peaks[bucketIdx * 2 + 1];
    const topY = midY - max * halfH;
    const botY = midY - min * halfH;
    const h = Math.max(1, botY - topY);
    ctx.fillRect(i * stride, topY, BAR_WIDTH, h);
  }
};

export const CanvasWaveform = ({
  audioUrl,
  height = 180,
  color = "#3a3a3a",
  onReady,
  onSeek,
}: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [duration, setDuration] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [decodeError, setDecodeError] = useState<string | null>(null);

  // Decode + extract peaks whenever the track URL changes.
  useEffect(() => {
    let cancelled = false;
    setPeaks(null);
    setDuration(0);
    setDecodeError(null);

    // Fast path — cached peaks from a previous decode. Skips fetch +
    // decodeAudioData + extractPeaks entirely; typical 1–2s → 0ms.
    const cached = loadCachedPeaks(audioUrl);
    if (cached) {
      setPeaks(cached.peaks);
      setDuration(cached.duration);
      onReady?.(cached.duration);
      return () => {
        cancelled = true;
      };
    }

    const load = async () => {
      try {
        const resp = await fetch(audioUrl);
        if (!resp.ok) return;
        const buf = await resp.arrayBuffer();
        if (cancelled) return;
        // OfflineAudioContext — does not touch the audio output device, so it
        // works even when another app (Rekordbox, Ableton, etc.) holds
        // exclusive audio. The constructor's sampleRate is a formal placeholder;
        // decodeAudioData preserves the source file's native rate.
        const OfflineCtx =
          window.OfflineAudioContext ||
          (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
            .webkitOfflineAudioContext;
        const offline = new OfflineCtx(1, 1, 44100);
        const audio = await offline.decodeAudioData(buf);
        if (cancelled) return;
        const channel = audio.getChannelData(0);
        const bucketSize = Math.max(256, Math.floor(channel.length / TARGET_BUCKETS));
        const extracted = extractPeaks(channel, bucketSize);
        const normalized = normalizePeaks(extracted);
        setPeaks(normalized);
        setDuration(audio.duration);
        onReady?.(audio.duration);
        saveCachedPeaks(audioUrl, normalized, audio.duration);
      } catch (err) {
        if (cancelled) return;
        // Surface the reason so Rekordbox / audio-device conflicts are
        // diagnosable without devtools. Rare in practice but real.
        setDecodeError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // onReady captured at load time — it's intentionally not a dep to avoid
    // re-decode on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl, onReady]);

  // Track the container's CSS width via ResizeObserver so the canvas resizes
  // with the layout without a window.resize listener round-trip.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number") setContainerWidth(w);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Redraw when peaks or container dimensions change.
  useEffect(() => {
    if (!peaks || !canvasRef.current || containerWidth <= 0) return;
    drawWaveform(canvasRef.current, peaks, containerWidth, height, color);
  }, [peaks, containerWidth, height, color]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const sec = Math.max(0, Math.min(duration, (x / rect.width) * duration));
    onSeek(sec);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer-driven editor canvas; keyboard UI is separate
    // biome-ignore lint/a11y/useKeyWithClickEvents: pointer-driven editor canvas; keyboard UI is separate
    <div
      ref={containerRef}
      onClick={handleClick}
      style={{
        position: "relative",
        width: "100%",
        height,
        cursor: "pointer",
        background: "#111",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height,
        }}
      />
      {!peaks && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            alignItems: "center",
            justifyContent: "center",
            color: decodeError ? "#f88" : "#666",
            fontSize: 11,
            padding: 12,
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          {decodeError ? (
            <>
              <div style={{ fontWeight: 600 }}>audio decode failed</div>
              <div style={{ fontSize: 10, color: "#c88" }}>{decodeError}</div>
              <div style={{ fontSize: 10, color: "#888" }}>
                Close Rekordbox / other apps holding audio, then reload.
              </div>
            </>
          ) : (
            "decoding audio…"
          )}
        </div>
      )}
    </div>
  );
};
