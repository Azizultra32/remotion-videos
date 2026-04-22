// Floating, draggable preview window that mirrors the main Preview's
// Player without taking over audio or the clock. Additive — the main
// editor grid is never touched. Close the window → editor is byte-
// identical to how it was before.
//
// Sync model:
//   - Read-only mirror. Subscribes to store.currentTimeSec and seeks its
//     own Player; subscribes to store.isPlaying and calls play/pause.
//   - Does NOT attach a frameupdate listener (single writer = main
//     Preview), does NOT mount an <audio> element (audio is main's job).
//   - So both Players show the same frame, but audio/clock contention
//     is impossible.
//
// Position + open state persist per project via useStorage (§7).
// z-index: 9999 keeps it above the rest of the editor at all times.

import {
  defaultMusicVideoProps,
  MusicVideo,
  type MusicVideoProps,
} from "@compositions/MusicVideo";
import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef } from "react";
import { useProjectAssetRegistry } from "../hooks/useProjectAssetRegistry";
import { useEditorStore } from "../store";
import { useStorage } from "../hooks/useStorage";
import { SIDEBAR_COL_WIDTH, DEFAULT_LEFT_MARGIN } from "../constants/layout";
import { stemFromAudioSrc, toEditorUrl } from "../utils/url";
import {
  computeDragPosition,
  type Pos,
  type DragBounds,
} from "../utils/floatingDrag";

const WINDOW_WIDTH = 800;
const WINDOW_HEIGHT = 450; // 16:9 match for 848x480 comp
const HEADER_HEIGHT = 32;
const TOTAL_HEIGHT = WINDOW_HEIGHT + HEADER_HEIGHT;

const defaultTopCenter = (): Pos => {
  // Never start on top of the left sidebar — the floating window would
  // otherwise cover the Element Library / Asset Library on first open.
  const sidebarSafeX = SIDEBAR_COL_WIDTH + DEFAULT_LEFT_MARGIN;
  if (typeof window === "undefined") return { x: sidebarSafeX, y: 24 };
  return {
    x: Math.max(sidebarSafeX, Math.floor((window.innerWidth - WINDOW_WIDTH) / 2)),
    y: 24,
  };
};

export const FloatingPreview = () => {
  const audioSrc = useEditorStore((s) => s.audioSrc);
  const stem = stemFromAudioSrc(audioSrc);
  const [open, setOpen] = useStorage(
    "floatingPreview:open",
    false,
    stem ?? undefined,
  );
  const [position, setPosition] = useStorage<Pos>(
    "floatingPreview:pos",
    defaultTopCenter(),
    stem ?? undefined,
  );

  const fps = useEditorStore((s) => s.fps);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const elements = useEditorStore((s) => s.elements);
  const events = useEditorStore((s) => s.events);
  const compositionDuration = useEditorStore((s) => s.compositionDuration);
  const beatsSrc = useEditorStore((s) => s.beatsSrc);

  const playerRef = useRef<PlayerRef>(null);
  const audioUrl = useMemo(() => toEditorUrl(audioSrc), [audioSrc]);

  const { assetRecords, assetRegistryError } = useProjectAssetRegistry();
  const hasAssetIds = useMemo(
    () => elements.some((element) => JSON.stringify(element.props ?? {}).includes('"ast_')),
    [elements],
  );

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

  // Mirror play/pause
  useEffect(() => {
    if (!open) return;
    const p = playerRef.current;
    if (!p) return;
    const desiredFrame = Math.round(useEditorStore.getState().currentTimeSec * fps);
    if (Math.abs(p.getCurrentFrame() - desiredFrame) > 2) {
      p.seekTo(desiredFrame);
    }
    if (isPlaying) p.play();
    else p.pause();
  }, [fps, isPlaying, open]);

  // Mirror seeks — subscribe imperatively to avoid re-rendering 24 Hz.
  useEffect(() => {
    if (!open) return;
    // Seek to current position on open (covers mid-track re-open).
    const p = playerRef.current;
    if (p) {
      const t0 = useEditorStore.getState().currentTimeSec;
      p.seekTo(Math.round(t0 * fps));
    }
    return useEditorStore.subscribe((state, prev) => {
      if (state.currentTimeSec === prev.currentTimeSec) return;
      const player = playerRef.current;
      if (!player) return;
      const desired = Math.round(state.currentTimeSec * fps);
      const actual = player.getCurrentFrame();
      if (Math.abs(desired - actual) > 2) player.seekTo(desired);
    });
  }, [fps, open]);

  const bounds: DragBounds = {
    viewportW: typeof window !== "undefined" ? window.innerWidth : 1440,
    viewportH: typeof window !== "undefined" ? window.innerHeight : 900,
    width: WINDOW_WIDTH,
    height: TOTAL_HEIGHT,
  };

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startPos: Pos = { ...position };
    const onMove = (m: PointerEvent) => {
      setPosition(
        computeDragPosition(
          startPos,
          { x: m.clientX - startX, y: m.clientY - startY },
          bounds,
        ),
      );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Launcher pill when closed — small, bottom-right of viewport, stays
  // clear of the chat pane (320px) and the timeline (360px).
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Pop out the preview into a floating, draggable window"
        style={{
          position: "fixed",
          right: 340,
          bottom: 380,
          zIndex: 9000,
          padding: "6px 10px",
          background: "#1a2a3a",
          border: "1px solid #368",
          borderRadius: 4,
          color: "#8cf",
          fontSize: 11,
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
        }}
      >
        ↗ Pop out preview
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        width: WINDOW_WIDTH,
        height: TOTAL_HEIGHT,
        zIndex: 9999,
        background: "#111",
        border: "1px solid #444",
        borderRadius: 6,
        boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {hasAssetIds && assetRegistryError ? (
        <div
          style={{
            position: "absolute",
            top: HEADER_HEIGHT + 8,
            left: 8,
            right: 8,
            zIndex: 20,
            padding: "8px 10px",
            borderRadius: 6,
            background: "rgba(96, 18, 18, 0.92)",
            border: "1px solid rgba(255, 160, 160, 0.35)",
            color: "#ffe3e3",
            fontSize: 12,
          }}
        >
          Asset registry failed to load. Asset-ID preview resolution may be incomplete.
        </div>
      ) : null}
      <div
        onPointerDown={onHeaderPointerDown}
        style={{
          height: HEADER_HEIGHT,
          padding: "0 8px",
          background: "#222",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "grab",
          touchAction: "none",
          userSelect: "none",
          fontSize: 11,
          color: "#888",
        }}
      >
        <span>Preview — drag to move</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          title="Close the floating preview"
          style={{
            background: "transparent",
            border: "none",
            color: "#aaa",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            padding: "0 6px",
          }}
        >
          ×
        </button>
      </div>
      <div style={{ flex: 1, background: "#000" }}>
        <Player
          ref={playerRef}
          component={MusicVideo}
          inputProps={inputProps as MusicVideoProps}
          compositionWidth={848}
          compositionHeight={480}
          fps={fps}
          durationInFrames={Math.round(compositionDuration * fps)}
          controls={false}
          style={{ width: "100%", height: "100%" }}
          clickToPlay={false}
        />
      </div>
    </div>
  );
};
