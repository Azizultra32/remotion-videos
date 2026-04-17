import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Audio } from "@remotion/media";
import { useWindowedAudioData, visualizeAudio } from "@remotion/media-utils";
import { z } from "zod";

export const publicCutSchema = z.object({
  audioSrc: z.string(),
  wavSrc: z.string(),
  stillSrc: z.string(),
  // AHURA
  ahuraPeak: z.number().min(5).max(60).step(0.5),
  ahuraSigma: z.number().min(2).max(20).step(0.5),
  zoomStart: z.number().min(1).max(3).step(0.1),
  zoomEnd: z.number().min(0.2).max(1).step(0.05),
  zoomDuration: z.number().min(10).max(90).step(1),
  ahuraGlowMultiplier: z.number().min(0).max(100).step(5),
  // Title timing (seconds)
  dubfireIn: z.number().min(20).max(90).step(0.5),
  dubfireDur: z.number().min(1).max(15).step(0.5),
  omegaIn: z.number().min(20).max(90).step(0.5),
  omegaDur: z.number().min(1).max(15).step(0.5),
  tIn: z.number().min(30).max(100).step(0.5),
  minusIn: z.number().min(30).max(100).step(0.5),
  twelveIn: z.number().min(30).max(100).step(0.5),
  fadeOutIn: z.number().min(30).max(100).step(0.5),
  fadeOutDur: z.number().min(1).max(10).step(0.5),
  // Image reveal
  imageIn: z.number().min(40).max(120).step(1),
  imageDur: z.number().min(5).max(30).step(1),
  // Spectrum
  showSpectrum: z.boolean(),
  spectrumOpacity: z.number().min(0).max(1).step(0.05),
  spectrumHeight: z.number().min(20).max(200).step(10),
});

const FONT = "'Helvetica Neue', Helvetica, Inter, system-ui, sans-serif";

const fade = (frame: number, fps: number, start: number, dur: number) =>
  interpolate(frame, [fps * start, fps * (start + dur)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

const SpectrumBars: React.FC<{
  frequencies: number[];
  width: number;
  height: number;
  opacity: number;
}> = ({ frequencies, width, height, opacity }) => {
  const nBars = 32;
  const barW = width / nBars;
  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        width: "100%",
        height,
        display: "flex",
        alignItems: "flex-end",
        opacity,
      }}
    >
      {Array.from({ length: nBars }, (_, i) => {
        const v = frequencies[Math.floor((i / nBars) * frequencies.length)] ?? 0;
        return (
          <div
            key={i}
            style={{
              width: barW - 1,
              marginRight: 1,
              height: v * height,
              background: `linear-gradient(180deg, rgba(255,255,255,${0.6 + v * 0.4}) 0%, rgba(255,255,255,0.03) 100%)`,
              boxShadow:
                v > 0.4
                  ? `0 0 ${v * 8}px rgba(255,255,255,${v * 0.3})`
                  : "none",
            }}
          />
        );
      })}
    </div>
  );
};

export const PublicCut: React.FC<z.infer<typeof publicCutSchema>> = (p) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;

  // Audio analysis
  const { audioData, dataOffsetInSeconds } = useWindowedAudioData({
    src: staticFile(p.wavSrc),
    frame,
    fps,
    windowInSeconds: 10,
  });

  let bassIntensity = 0;
  let frequencies: number[] = [];
  if (audioData) {
    frequencies = visualizeAudio({
      fps,
      frame,
      audioData,
      numberOfSamples: 128,
      optimizeFor: "speed",
      dataOffsetInSeconds,
    });
    const bass = frequencies.slice(0, 16);
    bassIntensity = bass.reduce((s, v) => s + v, 0) / bass.length;
  }

  // AHURA: bell curve opacity + zoom + bass glow
  const ahuraOpacity = Math.exp(
    -Math.pow(t - p.ahuraPeak, 2) / (2 * p.ahuraSigma ** 2),
  );
  const scale = interpolate(
    frame,
    [0, fps * p.zoomDuration],
    [p.zoomStart, p.zoomEnd],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const glow = bassIntensity * p.ahuraGlowMultiplier * ahuraOpacity;

  // Title reveals
  const rDubfire = fade(frame, fps, p.dubfireIn, p.dubfireDur);
  const rOmega = fade(frame, fps, p.omegaIn, p.omegaDur);
  const rT = fade(frame, fps, p.tIn, 1.5);
  const rMinus = fade(frame, fps, p.minusIn, 1.5);
  const r12a = fade(frame, fps, p.twelveIn, 0.8);
  const rColon = fade(frame, fps, p.twelveIn + 0.8, 0.4);
  const r12b = fade(frame, fps, p.twelveIn + 1.2, 0.8);
  const fadeDO = interpolate(
    frame,
    [fps * p.fadeOutIn, fps * (p.fadeOutIn + p.fadeOutDur)],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Image reveal
  const imageOpacity = fade(frame, fps, p.imageIn, p.imageDur);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Audio src={staticFile(p.audioSrc)} />

      {/* Still image */}
      <AbsoluteFill style={{ opacity: imageOpacity }}>
        <Img
          src={staticFile(p.stillSrc)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>

      {/* AHURA */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          opacity: ahuraOpacity,
          transform: `scale(${scale})`,
        }}
      >
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 200,
            fontSize: 380,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#fff",
            textShadow:
              glow > 1
                ? `0 0 ${glow}px rgba(255,255,255,0.8), 0 0 ${glow * 2.5}px rgba(180,180,255,0.25)`
                : "none",
          }}
        >
          AHURA
        </div>
      </AbsoluteFill>

      {/* Spectrum bars */}
      {p.showSpectrum && frequencies.length > 0 && (
        <SpectrumBars
          frequencies={frequencies}
          width={width}
          height={p.spectrumHeight}
          opacity={p.spectrumOpacity}
        />
      )}

      {/* Bottom-left title lockup */}
      <div
        style={{
          position: "absolute",
          left: 36,
          bottom: 28,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          textShadow: "0 1px 4px rgba(0,0,0,0.6)",
        }}
      >
        {/* T MINUS 12:12 */}
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 300,
            fontSize: 15,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.95)",
            display: "flex",
            gap: "0.35em",
          }}
        >
          <span style={{ opacity: rT }}>T</span>
          <span style={{ opacity: rMinus }}>Minus</span>
          <span style={{ display: "flex", gap: 0 }}>
            <span style={{ opacity: r12a }}>12</span>
            <span style={{ opacity: rColon }}>:</span>
            <span style={{ opacity: r12b }}>12</span>
          </span>
        </div>
        {/* Accent line */}
        <div
          style={{
            height: 1,
            width: 28 * rDubfire * fadeDO,
            backgroundColor: "rgba(255,255,255,0.85)",
          }}
        />
        {/* DUBFIRE OMEGA */}
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 300,
            fontSize: 15,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.95)",
            display: "flex",
            gap: "0.5em",
          }}
        >
          <span style={{ opacity: rDubfire * fadeDO }}>Dubfire</span>
          <span style={{ opacity: rOmega * fadeDO }}>Omega</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const defaultPublicCutProps: z.infer<typeof publicCutSchema> = {
  audioSrc: "dubfire-sake-audio.mp3",
  wavSrc: "dubfire-sake.wav",
  stillSrc: "dubfire-still.png",
  // AHURA
  ahuraPeak: 20,
  ahuraSigma: 7,
  zoomStart: 1.8,
  zoomEnd: 0.5,
  zoomDuration: 45,
  ahuraGlowMultiplier: 50,
  // Title
  dubfireIn: 50,
  dubfireDur: 8,
  omegaIn: 58,
  omegaDur: 6,
  tIn: 68,
  minusIn: 69.5,
  twelveIn: 74,
  fadeOutIn: 74,
  fadeOutDur: 3,
  // Image
  imageIn: 80,
  imageDur: 12,
  // Spectrum
  showSpectrum: true,
  spectrumOpacity: 0.4,
  spectrumHeight: 80,
};
