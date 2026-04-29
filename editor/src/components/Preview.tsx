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

import { defaultMusicVideoProps, MusicVideo, type MusicVideoProps } from "@compositions/MusicVideo";
import { type CallbackListener, Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef } from "react";
import { useProjectAssetRegistry } from "../hooks/useProjectAssetRegistry";
import { useEditorStore } from "../store";
import { shouldHardSeekAudio } from "../utils/previewTransport";
import { toEditorUrl } from "../utils/url";

export const Preview = () => {
  const playerRef = useRef<PlayerRef>(null);
  const audioElRef = useRef<HTMLAudioElement>(null);
  const lastPlayerClockTimeSecRef = useRef<number | null>(null);

  const fps = useEditorStore((s) => s.fps);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const elements = useEditorStore((s) => s.elements);
  const events = useEditorStore((s) => s.events);
  const compositionDuration = useEditorStore((s) => s.compositionDuration);
  const audioSrc = useEditorStore((s) => s.audioSrc);
  const beatsSrc = useEditorStore((s) => s.beatsSrc);

  const { assetRecords, assetRegistryError } = useProjectAssetRegistry();
  const hasAssetIds = useMemo(
    () => elements.some((element) => JSON.stringify(element.props ?? {}).includes('"ast_')),
    [elements],
  );

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
      beatsSrc,
      elements,
      events,
      muteAudioTag: true,
      analysisAudioSrc: audioUrl,
      assetRegistry:
        assetRecords.map((r) => ({ id: r.id, path: r.path, aliases: r.aliases })),
    }),
    [assetRecords, audioUrl, beatsSrc, elements, events],
  );

  // Transport: isPlaying drives BOTH the Player (visuals) and the <audio>
  // element (audio). Two separate, direct calls — no framework magic.
  useEffect(() => {
    const player = playerRef.current;
    const audioEl = audioElRef.current;
    const desiredSec = useEditorStore.getState().currentTimeSec;
    const desiredFrame = Math.round(desiredSec * fps);
    if (isPlaying) {
      if (player && Math.abs(player.getCurrentFrame() - desiredFrame) > 2) {
        player.seekTo(desiredFrame);
      }
      if (audioEl && Math.abs(audioEl.currentTime - desiredSec) > 0.05) {
        audioEl.currentTime = desiredSec;
      }
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

      const lastPlayerClockTimeSec = lastPlayerClockTimeSecRef.current;
      const isPlayerClockUpdate =
        state.isPlaying &&
        prev.isPlaying &&
        lastPlayerClockTimeSec !== null &&
        Math.abs(lastPlayerClockTimeSec - state.currentTimeSec) <= 0.5 / Math.max(1, fps);
      if (isPlayerClockUpdate) return;

      const player = playerRef.current;
      const audioEl = audioElRef.current;
      const desired = Math.round(state.currentTimeSec * fps);
      if (player) {
        const actual = player.getCurrentFrame();
        if (Math.abs(desired - actual) > 2) player.seekTo(desired);
      }
      const audioDeltaSec = audioEl ? Math.abs(audioEl.currentTime - state.currentTimeSec) : 0;
      if (audioEl && shouldHardSeekAudio({ state, prev, audioDeltaSec })) {
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
    const handler: CallbackListener<"frameupdate"> = (e) => {
      const currentTimeSec = e.detail.frame / fps;
      lastPlayerClockTimeSecRef.current = currentTimeSec;
      useEditorStore.setState({ currentTimeSec });
    };
    player.addEventListener("frameupdate", handler);
    return () => player.removeEventListener("frameupdate", handler);
  }, [fps]);

  return (
    <div className="preview-container" style={{ width: "100%", height: "100%", margin: 6 }}>
      {hasAssetIds && assetRegistryError ? (
        <div className="preview-error-overlay" style={{ inset: "auto 8px auto 8px", top: 8, bottom: "auto", borderRadius: "var(--radius-md)" }}>
          Asset registry failed to load. Asset-ID preview resolution may be incomplete.
        </div>
      ) : null}
      {/* biome-ignore lint/a11y/useMediaCaption: editor preview audio — captions not applicable (raw track playback, no speech content) */}
      {audioUrl && <audio ref={audioElRef} src={audioUrl} preload="auto" />}
      <Player
        ref={playerRef}
        component={MusicVideo}
        // Player's inputProps is typed against the schema generic (see Root.tsx
        // for the same library-type gap); narrow to the component's own props.
        inputProps={inputProps as MusicVideoProps}
        compositionWidth={848}
        compositionHeight={480}
        fps={fps}
        durationInFrames={Math.round(compositionDuration * fps)}
        controls={false}
        style={{ width: "100%", height: "100%" }}
        clickToPlay={false}
        errorFallback={({ error }) => (
          <div className="preview-error-overlay" style={{ fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", overflow: "auto", alignItems: "flex-start", padding: 20 }}>
            <div style={{ color: "var(--danger)", fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Composition error</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 11 }}>{error.message}</div>
            {error.stack && (
              <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 10 }}>{error.stack}</div>
            )}
          </div>
        )}
      />
    </div>
  );
};
