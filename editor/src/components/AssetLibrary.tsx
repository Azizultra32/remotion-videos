// editor/src/components/AssetLibrary.tsx
//
// Dashboard-level asset panel. Polls /api/assets/list and turns a thumbnail
// into a one-click "add element at playhead" affordance. Click = default
// action; shift+click = copy path (will be replaced by right-click menu).
//
// On the word "engine": it is DELIBERATELY absent here. In this codebase
// "engine" means the write-locked application code (src/**, editor/**, etc.
// governed by ENGINE_UNLOCK=1). The shared-across-projects scope for a PNG
// file is NOT engine — it is just a library of content that happens to live
// at public/assets/. Using "engine" as a UI label would steal vocabulary
// from a different layer and imply the file needs unlock to modify, which
// is false. The wire value stays scope: "global" (truthful — visible to
// every project); the UI label is "Library".

import { ELEMENT_REGISTRY } from "@compositions/elements/registry";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "../store";
import type { TimelineElement } from "../types";

type AssetEntry = {
  path: string;
  scope: "global" | "project";
  stem: string | null;
  kind: "image" | "video";
  size: number;
  mtime: number;
};

const POLL_MS = 2000;

// Click-to-add defaults. Swap these to change what type of element a click
// produces for each kind. The static-image module is the right default here
// because "I dropped a photo onto the timeline" should produce a photo on
// screen, not a beat-cycling sequence of one image.
const IMAGE_MODULE_ID = "overlay.staticImage";
const VIDEO_MODULE_ID = "overlay.speedVideo";

const newId = () => `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const urlFor = (e: AssetEntry): string =>
  e.path.startsWith("assets/") ? `/${e.path}` : `/api/projects/${e.path.replace(/^projects\//, "")}`;

const kbLabel = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`;

// Cheap content hash over the entries list. We only need to notice when the
// set of files changed (new / removed / touched). Counting + max-mtime is
// sufficient and avoids JSON.stringify on every poll.
const hashEntries = (es: AssetEntry[]): string => {
  let maxM = 0;
  for (const e of es) if (e.mtime > maxM) maxM = e.mtime;
  return `${es.length}:${maxM}`;
};

export const AssetLibrary = () => {
  const [entries, setEntries] = useState<AssetEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [scopeFilter, setScopeFilter] = useState<"all" | "global" | "project">("all");
  const [kindFilter, setKindFilter] = useState<"all" | "image" | "video">("all");
  const [search, setSearch] = useState("");
  const prevHashRef = useRef<string>("");

  // Poll every POLL_MS so files dropped into public/assets/ appear without
  // reloading the editor. Two optimizations vs the naive interval:
  //   1. Skip the fetch entirely when the tab is hidden.
  //   2. Skip setState when the content hash is unchanged — React would
  //      otherwise re-render the whole tile grid every 2s for nothing.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const r = await fetch("/api/assets/list");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data: AssetEntry[] = await r.json();
        if (cancelled) return;
        const h = hashEntries(data);
        if (h === prevHashRef.current) {
          setError(null);
          return;
        }
        prevHashRef.current = h;
        setEntries(data);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(String((err as Error)?.message ?? err));
      }
    };
    void load();
    const id = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = search.toLowerCase();
    return entries.filter((e) => {
      if (scopeFilter !== "all" && e.scope !== scopeFilter) return false;
      if (kindFilter !== "all" && e.kind !== kindFilter) return false;
      if (q && !e.path.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, scopeFilter, kindFilter, search]);

  const addElementForAsset = (e: AssetEntry) => {
    const state = useEditorStore.getState();
    const modId = e.kind === "image" ? IMAGE_MODULE_ID : VIDEO_MODULE_ID;
    const mod = ELEMENT_REGISTRY[modId];
    if (!mod) {
      setError(`element module ${modId} not found`);
      return;
    }
    const seededProps =
      e.kind === "image"
        ? { ...mod.defaults, imageSrc: e.path }
        : { ...mod.defaults, videoSrc: e.path };
    const el: TimelineElement = {
      id: newId(),
      label: `${mod.label}: ${e.path.split("/").pop()}`,
      type: mod.id,
      trackIndex: mod.defaultTrack,
      startSec: Math.max(0, state.currentTimeSec),
      durationSec: mod.defaultDurationSec,
      props: seededProps,
    };
    state.addElement(el);
    state.selectElement(el.id);
  };

  const copyPath = async (e: AssetEntry) => {
    try {
      await navigator.clipboard.writeText(e.path);
    } catch {
      /* silently ignore; some browsers block clipboard without a user gesture */
    }
  };

  const handleTileClick = (e: AssetEntry, shiftKey: boolean) => {
    if (shiftKey) void copyPath(e);
    else addElementForAsset(e);
  };

  const onTileDragStart = (e: AssetEntry, ev: React.DragEvent<HTMLButtonElement>) => {
    ev.dataTransfer.setData(
      "application/x-mv-asset",
      JSON.stringify({ path: e.path, kind: e.kind }),
    );
    ev.dataTransfer.effectAllowed = "copy";
    const img = ev.currentTarget.querySelector("img, video") as HTMLElement | null;
    if (img) {
      const rect = (img as HTMLElement).getBoundingClientRect();
      ev.dataTransfer.setDragImage(img, rect.width / 2, rect.height / 2);
    }
  };

  // OS-drag dropzone: user drags a file from Finder onto the panel and it
  // gets POSTed to /api/assets/upload. The upload handler writes to
  // public/assets/{images,videos}/, and the next polling tick picks up
  // the new file automatically. We also force an immediate refresh after
  // upload so the user sees the tile instantly instead of waiting up to
  // POLL_MS.
  const [dropActive, setDropActive] = useState(false);
  const [uploading, setUploading] = useState(0);

  const uploadFile = async (file: File): Promise<void> => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    const r = await fetch("/api/assets/upload", { method: "POST", body: fd });
    if (!r.ok) {
      const text = await r.text().catch(() => `HTTP ${r.status}`);
      throw new Error(text);
    }
  };

  const handleOsDrop = async (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    setDropActive(false);
    // Ignore our own intra-app tile drags (they carry x-mv-asset).
    if (ev.dataTransfer.types.includes("application/x-mv-asset")) return;
    const files = Array.from(ev.dataTransfer.files ?? []);
    if (files.length === 0) return;
    setUploading(files.length);
    try {
      for (const f of files) {
        try { await uploadFile(f); }
        catch (err) { setError(`upload failed: ${String(err)}`); }
      }
      // Force an immediate list refresh. Invalidate the hash so the
      // poll effect re-renders.
      prevHashRef.current = "";
    } finally {
      setUploading(0);
    }
  };

  const handleOsDragOver = (ev: React.DragEvent<HTMLDivElement>) => {
    // Accept only OS file drags, not intra-app tile drags.
    if (ev.dataTransfer.types.includes("application/x-mv-asset")) return;
    if (!ev.dataTransfer.types.includes("Files")) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "copy";
    if (!dropActive) setDropActive(true);
  };
  const handleOsDragLeave = (ev: React.DragEvent<HTMLDivElement>) => {
    // Only clear when leaving the panel itself, not a child tile.
    if (ev.currentTarget === ev.target) setDropActive(false);
  };

  const header = (
    <button
      type="button"
      onClick={() => setCollapsed((c) => !c)}
      style={{
        all: "unset",
        display: "flex",
        alignItems: "center",
        gap: 6,
        cursor: "pointer",
        margin: "0 0 8px 0",
        width: "100%",
      }}
      title={collapsed ? "Expand asset library" : "Collapse asset library"}
    >
      <span style={{ fontSize: 9, color: "#888", width: 10 }}>{collapsed ? "▶" : "▼"}</span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "#666",
          letterSpacing: "0.1em",
        }}
      >
        ASSETS
      </span>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 9, color: "#555" }}>
        {entries ? `${filtered.length}/${entries.length}` : "…"}
      </span>
    </button>
  );

  // Segmented filter: single row of chip buttons. Denser and clearer in a
  // 240px rail than two native <select> dropdowns.
  const segBtn = (active: boolean): React.CSSProperties => ({
    padding: "2px 6px",
    background: active ? "#2a4a7a" : "#1a1a1a",
    border: `1px solid ${active ? "#3a6aaa" : "#333"}`,
    color: active ? "#fff" : "#aaa",
    fontSize: 10,
    borderRadius: 3,
    cursor: "pointer",
    flex: 1,
    minWidth: 0,
  });

  return (
    <div
      onDragOver={handleOsDragOver}
      onDragLeave={handleOsDragLeave}
      onDrop={handleOsDrop}
      style={{
        padding: 12,
        borderTop: "1px solid #333",
        borderBottom: "1px solid #333",
        background: dropActive ? "#1a2a3a" : "#0a0a0a",
        outline: dropActive ? "2px dashed #3a6aaa" : "none",
        outlineOffset: -2,
        position: "relative",
        transition: "background 0.1s",
      }}
    >
      {uploading > 0 && (
        <div style={{
          position: "absolute", top: 4, right: 8,
          fontSize: 9, color: "#aaa",
          background: "#1a1a1a", border: "1px solid #333",
          padding: "2px 6px", borderRadius: 3, zIndex: 2,
        }}>
          Uploading {uploading}…
        </div>
      )}
      {header}
      {!collapsed && (
        <>
          <div style={{ display: "flex", gap: 3, marginBottom: 4 }}>
            <button type="button" style={segBtn(kindFilter === "all")} onClick={() => setKindFilter("all")}>All</button>
            <button type="button" style={segBtn(kindFilter === "image")} onClick={() => setKindFilter("image")}>Img</button>
            <button type="button" style={segBtn(kindFilter === "video")} onClick={() => setKindFilter("video")}>Vid</button>
          </div>
          <div style={{ display: "flex", gap: 3, marginBottom: 6 }}>
            <button type="button" style={segBtn(scopeFilter === "all")} onClick={() => setScopeFilter("all")}>Any scope</button>
            <button type="button" style={segBtn(scopeFilter === "global")} onClick={() => setScopeFilter("global")} title="Library — shared across all projects">Library</button>
            <button type="button" style={segBtn(scopeFilter === "project")} onClick={() => setScopeFilter("project")}>Project</button>
          </div>
          <input
            type="text"
            value={search}
            onChange={(ev) => setSearch(ev.target.value)}
            placeholder="Filter by name…"
            style={{
              background: "#1a1a1a",
              border: "1px solid #333",
              borderRadius: 3,
              color: "#ddd",
              fontSize: 10,
              padding: "3px 6px",
              width: "100%",
              marginBottom: 8,
              boxSizing: "border-box",
            }}
          />

          {error && (
            <div style={{ color: "#f66", fontSize: 10, marginBottom: 6 }}>
              {error}
            </div>
          )}

          {!entries && !error && (
            <div style={{ color: "#666", fontSize: 10, padding: "8px 0" }}>Loading…</div>
          )}

          {entries && filtered.length === 0 && (
            <div
              style={{
                color: "#666",
                fontSize: 10,
                fontStyle: "italic",
                lineHeight: 1.4,
                padding: "8px 0",
              }}
            >
              {entries.length === 0
                ? "No assets yet. Drop files into public/assets/images/ or public/assets/videos/ — they'll appear here within a couple of seconds."
                : "No matches for current filters."}
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 4,
            }}
          >
            {filtered.map((e) => (
              <button
                key={e.path}
                type="button"
                draggable
                onClick={(ev) => handleTileClick(e, ev.shiftKey)}
                onDragStart={(ev) => onTileDragStart(e, ev)}
                title={`${e.path}\n${kbLabel(e.size)} · ${new Date(e.mtime).toLocaleString()}\nClick: add ${e.kind} element at playhead\nShift+click: copy path\nDrag: drop onto a timeline track`}
                style={{
                  position: "relative",
                  padding: 0,
                  background: "#1a1a1a",
                  border: "1px solid #333",
                  borderRadius: 3,
                  cursor: "grab",
                  overflow: "hidden",
                  aspectRatio: "1 / 1",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    background: "#000",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: 0,
                  }}
                >
                  {e.kind === "image" ? (
                    <img
                      src={urlFor(e)}
                      alt={e.path}
                      draggable={false}
                      style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
                    />
                  ) : (
                    <video
                      src={urlFor(e)}
                      muted
                      preload="metadata"
                      style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
                    />
                  )}
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: "#bbb",
                    padding: "3px 4px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    borderTop: "1px solid #222",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 4,
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                    {e.path.split("/").pop()}
                  </span>
                  <span style={{ color: "#555", fontSize: 8 }}>
                    {e.scope === "global" ? "lib" : (e.stem ?? "").slice(0, 3)}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {entries && entries.length > 0 && (
            <div style={{ fontSize: 9, color: "#555", marginTop: 8, lineHeight: 1.4 }}>
              Click to add at the playhead · Shift+click to copy path · Drag onto a timeline track for precise placement.
            </div>
          )}
        </>
      )}
    </div>
  );
};
