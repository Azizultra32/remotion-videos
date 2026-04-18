// src/components/Preview.tsx
//
// Editor preview. We own audio directly via a plain <audio> element —
// Remotion's Player handles visuals only. This inversion exists because
// Remotion's dev-mode audio path wouldn't reliably pause in our setup
// (possibly SharedAudioContext or prefetched media), and an editor needs
// the transport to be the authority. MusicVideo's own <Audio> is
// suppressed in the preview by passing audioSrc=null; at render time
// (remotion render), the CLI passes audioSrc through and the composition
// plays it normally.
import { Player, PlayerRef } from "@remotion/player";
import { useRef, useEffect, useMemo } from "react";
import { useEditorStore } from "../store";
import { MusicVideo, defaultMusicVideoProps } from "@compositions/MusicVideo";
import { toEditorUrl } from "../utils/url";

export const Preview = () => {
  const playerRef = useRef<PlayerRef>(null);
  const audioElRef = useRef<HTMLAudioElement>(null);

  const fps = useEditorStore((s) => s.fps);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const elements = useEditorStore((s) => s.elements);
  const compositionDuration = useEditorStore((s) => s.compositionDuration);
  const audioSrc = useEditorStore((s) => s.audioSrc);
  const beatsSrc = useEditorStore((s) => s.beatsSrc);

  // Resolve audio URL via the canonical helper (routes projects/<stem>/... to
  // /api/projects/<stem>/... under the sidecar's serving).
  const audioUrl = useMemo(() => toEditorUrl(audioSrc), [audioSrc]);

  // Visuals only: force audioSrc=null + muteAudioTag so MusicVideo skips
  // its <Audio> tag. The separate <audio> element below owns playback.
  // But we still hand the audio URL to analysis hooks via analysisAudioSrc
  // so audio-reactive elements (SpectrumBars, WaveformPath, BassGlow) keep
  // working — they fetch/decode via useWindowedAudioData, independent of
  // any mounted <Audio> tag.
  const inputProps = useMemo(
    () => ({
      ...defaultMusicVideoProps,
      audioSrc: null,
      beatsSrc: beatsSrc ?? defaultMusicVideoProps.beatsSrc,
      elements,
      muteAudioTag: true,
      analysisAudioSrc: audioUrl,
    }),
    [audioUrl, beatsSrc, elements],
  );

  // Transport: isPlaying drives BOTH the Player (visuals) and the <audio>
  // element (audio). Two separate, direct calls — no framework magic.
  useEffect(() => {
    const player = playerRef.current;
    const audioEl = audioElRef.current;
    if (isPlaying) {
      player?.play();
      audioEl?.play().catch(() => {});
    } else {
      player?.pause();
      audioEl?.pause();
    }
  }, [isPlaying]);

  // Keep <audio> in sync with the Player's clock. Subscribe once; read
  // currentTimeSec fresh so this effect doesn't re-run on every tick.
  useEffect(() => {
    const unsub = useEditorStore.subscribe((state, prev) => {
      if (state.currentTimeSec === prev.currentTimeSec) return;
      const player = playerRef.current;
      const audioEl = audioElRef.current;
      const desired = Math.round(state.currentTimeSec * fps);
      if (player) {
        const actual = player.getCurrentFrame();
        if (Math.abs(desired - actual) > 2) player.seekTo(desired);
      }
      if (audioEl && Math.abs(audioEl.currentTime - state.currentTimeSec) > 0.25) {
        audioEl.currentTime = state.currentTimeSec;
      }
    });
    return unsub;
  }, [fps]);

  // Player → store: drive currentTimeSec from the Player's frame clock so
  // the scrubber playhead tracks visual playback. Audio is kept in sync
  // via the subscribe above.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const handler = (e: { detail: { frame: number } }) => {
      useEditorStore.setState({ currentTimeSec: e.detail.frame / fps });
    };
    player.addEventListener("frameupdate", handler as any);
    return () => player.removeEventListener("frameupdate", handler as any);
  }, [fps]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {audioUrl && (
        <audio ref={audioElRef} src={audioUrl} preload="auto" />
      )}
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
    </div>
  );
};
