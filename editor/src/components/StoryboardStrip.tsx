// src/components/StoryboardStrip.tsx
//
// Horizontal strip of "scene cards" that plan the video structurally. Sits
// above the Scrubber so the cards align temporally with the waveform below.
// Each card shows its name + time range; click to seek; edit button opens a
// modal; delete asks for confirm.
//
// Data lives in store.scenes; persistence is useStoryboardSync → storyboard.json.

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store";
import type { Scene } from "../types";

const fmtTime = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const newSceneId = () => `scene-${Math.random().toString(36).slice(2, 9)}`;

type EditDraft = {
  id: string | null; // null = creating new
  name: string;
  startSec: string;
  endSec: string;
  intent: string;
};

const emptyDraft = (startSec = 0, endSec = 30): EditDraft => ({
  id: null,
  name: "",
  startSec: startSec.toFixed(1),
  endSec: endSec.toFixed(1),
  intent: "",
});

export const StoryboardStrip = () => {
  const scenes = useEditorStore((s) => s.scenes);
  const addScene = useEditorStore((s) => s.addScene);
  const updateScene = useEditorStore((s) => s.updateScene);
  const removeScene = useEditorStore((s) => s.removeScene);
  const currentTimeSec = useEditorStore((s) => s.currentTimeSec);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const audioSrc = useEditorStore((s) => s.audioSrc);
  const compositionDuration = useEditorStore((s) => s.compositionDuration);

  const [editing, setEditing] = useState<EditDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  // Sort by startSec so cards render left-to-right in time order.
  const sorted = [...scenes].sort((a, b) => a.startSec - b.startSec);

  // Which scene currently covers the playhead? Highlight it.
  const activeId =
    sorted.find((sc) => currentTimeSec >= sc.startSec && currentTimeSec < sc.endSec)?.id ?? null;

  const openCreate = () => {
    const start = Number.isFinite(currentTimeSec) ? Math.max(0, currentTimeSec) : 0;
    setEditing(emptyDraft(start, start + 30));
    setError(null);
  };

  const openEdit = (sc: Scene) => {
    setEditing({
      id: sc.id,
      name: sc.name,
      startSec: sc.startSec.toFixed(3),
      endSec: sc.endSec.toFixed(3),
      intent: sc.intent,
    });
    setError(null);
  };

  const save = useCallback(() => {
    if (!editing) return;
    const start = Number(editing.startSec);
    const end = Number(editing.endSec);
    if (!Number.isFinite(start) || start < 0) {
      setError("start must be a non-negative number");
      return;
    }
    if (!Number.isFinite(end) || end <= start) {
      setError("end must be greater than start");
      return;
    }
    const name = editing.name.trim() || "Untitled scene";
    const intent = editing.intent.trim();
    if (editing.id === null) {
      addScene({
        id: newSceneId(),
        name,
        startSec: start,
        endSec: end,
        intent,
        linkedElementIds: [],
        linkedEventNames: [],
      });
    } else {
      updateScene(editing.id, { name, startSec: start, endSec: end, intent });
    }
    setEditing(null);
    setError(null);
  }, [editing, addScene, updateScene]);

  const del = (sc: Scene) => {
    if (
      !window.confirm(
        `Delete scene "${sc.name || "(unnamed)"}"? This doesn't touch any linked timeline elements.`,
      )
    )
      return;
    removeScene(sc.id);
  };

  // Escape closes the modal.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditing(null);
      else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing, save]);

  if (!audioSrc) return null; // nothing to storyboard against

  const totalSec = compositionDuration || 1;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 8,
        padding: "6px 16px",
        borderBottom: "1px solid #222",
        background: "#0a0a0a",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 90 }}>
        <span
          style={{
            fontSize: 10,
            color: "#888",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
          title="Scenes plan the video structurally. Each scene is a named chunk of time with creative intent, rendered as a proportional block aligned with the waveform below. Click a card to seek; double-click to edit."
        >
          Storyboard
        </span>
        <button
          type="button"
          onClick={openCreate}
          style={{
            padding: "3px 10px",
            fontSize: 10,
            fontFamily: "monospace",
            background: "#1a3a1a",
            border: "1px solid #386",
            borderRadius: 3,
            color: "#afa",
            cursor: "pointer",
            whiteSpace: "nowrap",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
          title="Add a scene at the current playhead position (30s default duration; edit after create)."
        >
          + Scene
        </button>
      </div>
      <div
        style={{
          position: "relative",
          flex: 1,
          minWidth: 0,
          height: 56,
          background: "#111",
          border: "1px solid #1f1f1f",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        {/* Playhead: red line at currentTime, matches the waveform below */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${Math.max(0, Math.min(100, (currentTimeSec / totalSec) * 100))}%`,
            width: 2,
            background: "#ff4444",
            transform: "translateX(-1px)",
            pointerEvents: "none",
            zIndex: 5,
          }}
        />
        {sorted.length === 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#555",
              fontSize: 11,
              fontStyle: "italic",
              pointerEvents: "none",
            }}
          >
            No scenes yet — click + SCENE to add one at the playhead
          </div>
        )}
        {sorted.map((sc) => {
          const isActive = sc.id === activeId;
          const leftPct = (sc.startSec / totalSec) * 100;
          const widthPct = Math.max(1.5, ((sc.endSec - sc.startSec) / totalSec) * 100);
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: pointer-driven editor canvas
            // biome-ignore lint/a11y/useKeyWithClickEvents: pointer-driven editor canvas
            <div
              key={sc.id}
              style={{
                position: "absolute",
                top: 4,
                bottom: 4,
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                background: isActive ? "#1e3a5f" : "#162028",
                border: `1px solid ${isActive ? "#64b5f6" : "#2a3a4a"}`,
                borderRadius: 3,
                padding: "2px 6px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                overflow: "hidden",
                cursor: "pointer",
                fontSize: 10,
                fontFamily: "monospace",
              }}
              onClick={() => setCurrentTime(sc.startSec)}
              onDoubleClick={() => openEdit(sc)}
              title={`${sc.name || "(unnamed)"}\n${fmtTime(sc.startSec)}–${fmtTime(sc.endSec)}${sc.intent ? `\n\n${sc.intent}` : ""}\n\nClick: seek to start. Double-click: edit.`}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 4 }}>
                <span
                  style={{
                    color: "#fff",
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                  }}
                >
                  {sc.name || "Untitled"}
                </span>
                <span style={{ color: "#888", fontSize: 9, whiteSpace: "nowrap" }}>
                  {fmtTime(sc.startSec)}–{fmtTime(sc.endSec)}
                </span>
              </div>
              {sc.intent && (
                <span
                  style={{
                    color: "#9ab",
                    fontSize: 9,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {sc.intent}
                </span>
              )}
              <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openEdit(sc);
                  }}
                  title="Edit scene"
                  style={{
                    padding: "0 4px",
                    background: "transparent",
                    border: "1px solid #446",
                    color: "#8bf",
                    fontSize: 9,
                    borderRadius: 2,
                    cursor: "pointer",
                  }}
                >
                  edit
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    del(sc);
                  }}
                  title="Delete scene"
                  style={{
                    padding: "0 4px",
                    background: "transparent",
                    border: "1px solid #644",
                    color: "#f88",
                    fontSize: 9,
                    borderRadius: 2,
                    cursor: "pointer",
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        // biome-ignore lint/a11y/noStaticElementInteractions: pointer-driven editor canvas; keyboard UI is separate
        // biome-ignore lint/a11y/useKeyWithClickEvents: pointer-driven editor canvas; keyboard UI is separate
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditing(null);
          }}
        >
          <div
            ref={modalRef}
            style={{
              background: "#151515",
              border: "1px solid #333",
              borderRadius: 6,
              padding: 20,
              width: 420,
              maxWidth: "90vw",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              color: "#fff",
              fontSize: 12,
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "#888",
              }}
            >
              {editing.id === null ? "New scene" : "Edit scene"}
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 10, color: "#aaa" }}>Name</span>
              <input
                type="text"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="e.g. Intro rise, First drop, Outro"
                style={{
                  padding: "6px 8px",
                  background: "#1a1a1a",
                  border: "1px solid #333",
                  color: "#fff",
                  borderRadius: 4,
                  fontSize: 12,
                }}
              />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 10, color: "#aaa" }}>Start (sec)</span>
                <input
                  type="number"
                  step="0.001"
                  min={0}
                  value={editing.startSec}
                  onChange={(e) => setEditing({ ...editing, startSec: e.target.value })}
                  style={{
                    padding: "6px 8px",
                    background: "#1a1a1a",
                    border: "1px solid #333",
                    color: "#fff",
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                />
              </label>
              <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 10, color: "#aaa" }}>End (sec)</span>
                <input
                  type="number"
                  step="0.001"
                  min={0}
                  value={editing.endSec}
                  onChange={(e) => setEditing({ ...editing, endSec: e.target.value })}
                  style={{
                    padding: "6px 8px",
                    background: "#1a1a1a",
                    border: "1px solid #333",
                    color: "#fff",
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                />
              </label>
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 10, color: "#aaa" }}>Intent / creative direction</span>
              <textarea
                value={editing.intent}
                onChange={(e) => setEditing({ ...editing, intent: e.target.value })}
                rows={4}
                placeholder="e.g. slow build; no text; bass ride on the low end until the drop"
                style={{
                  padding: "6px 8px",
                  background: "#1a1a1a",
                  border: "1px solid #333",
                  color: "#fff",
                  borderRadius: 4,
                  fontSize: 12,
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
            </label>
            {error && (
              <div style={{ fontSize: 10, color: "#f66", fontFamily: "monospace" }}>{error}</div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
              <button
                type="button"
                onClick={() => setEditing(null)}
                style={{
                  padding: "6px 12px",
                  background: "#222",
                  border: "1px solid #444",
                  color: "#ddd",
                  fontSize: 11,
                  borderRadius: 3,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                style={{
                  padding: "6px 12px",
                  background: "#1a3a1a",
                  border: "1px solid #386",
                  color: "#afa",
                  fontSize: 11,
                  borderRadius: 3,
                  cursor: "pointer",
                }}
                title="⌘↩ also saves"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
