// editor/src/components/AssetLibrary.tsx
//
// Dashboard-level asset panel (distinct from the modal AssetPicker that
// opens from a SchemaEditor field button). Always visible in the left rail,
// polls /api/assets/list for a live inventory of engine-wide + per-project
// media, and turns a thumbnail into a one-click "add element at playhead"
// affordance. Click = default action for the kind; shift+click = copy path.
//
// Why a panel AND a modal, not just one:
//   - Modal (AssetPicker): reactive — already inside an element's field,
//     need to pick a file for THAT field.
//   - Panel (this file): proactive — browsing the library, want to drop
//     an asset ONTO the timeline and let the editor decide which element
//     wraps it.

import { ELEMENT_REGISTRY } from "@compositions/elements/registry";
import { useEffect, useMemo, useState } from "react";
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

// When the user clicks a tile, we drop it onto the timeline wrapped in the
// appropriate element module. Kept as two constants so they're easy to swap
// (e.g., swap BeatImageCycle for a simpler "static image" module later).
const IMAGE_MODULE_ID = "overlay.beatImageCycle"; // images: string[]
const VIDEO_MODULE_ID = "overlay.speedVideo";     // videoSrc: string

const newId = () => `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const urlFor = (e: AssetEntry): string =>
  e.path.startsWith("assets/") ? `/${e.path}` : `/api/projects/${e.path.replace(/^projects\//, "")}`;

const kbLabel = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`;

export const AssetLibrary = () => {
  const [entries, setEntries] = useState<AssetEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [scopeFilter, setScopeFilter] = useState<"all" | "global" | "project">("all");
  const [kindFilter, setKindFilter] = useState<"all" | "image" | "video">("all");
  const [search, setSearch] = useState("");

  // Poll every POLL_MS so files dropped into public/assets/ appear without
  // reloading the editor. Cancel-flag on unmount keeps useEffect tidy.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch("/api/assets/list");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data: AssetEntry[] = await r.json();
        if (!cancelled) {
          setEntries(data);
          setError(null);
        }
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
        ? { ...mod.defaults, images: [e.path] }
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
      <span style={{ fontSize: 9, color: "#888", width: 10 }}>{collapsed ? "\u25B6" : "\u25BC"}</span>
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
        {entries ? `${filtered.length}/${entries.length}` : "\u2026"}
      </span>
    </button>
  );

  return (
    <div
      style={{
        padding: 12,
        borderTop: "1px solid #333",
        borderBottom: "1px solid #333",
        background: "#0a0a0a",
      }}
    >
      {header}
      {!collapsed && (
        <>
          <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
            <select
              value={scopeFilter}
              onChange={(ev) => setScopeFilter(ev.target.value as typeof scopeFilter)}
              style={selectStyle}
              title="Filter by scope"
            >
              <option value="all">All scopes</option>
              <option value="global">Engine</option>
              <option value="project">Project</option>
            </select>
            <select
              value={kindFilter}
              onChange={(ev) => setKindFilter(ev.target.value as typeof kindFilter)}
              style={selectStyle}
              title="Filter by media kind"
            >
              <option value="all">Any</option>
              <option value="image">Images</option>
              <option value="video">Videos</option>
            </select>
          </div>
          <input
            type="text"
            value={search}
            onChange={(ev) => setSearch(ev.target.value)}
            placeholder="Filter by name\u2026"
            style={{
              ...selectStyle,
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
            <div style={{ color: "#666", fontSize: 10, padding: "8px 0" }}>Loading\u2026</div>
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
                ? "No assets yet. Drop files into public/assets/images/ or public/assets/videos/ \u2014 they'll appear here within a couple of seconds."
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
                onClick={(ev) => handleTileClick(e, ev.shiftKey)}
                title={`${e.path}\n${kbLabel(e.size)} \u00B7 ${new Date(e.mtime).toLocaleString()}\nClick: add ${e.kind} element at playhead\nShift+click: copy path`}
                style={{
                  position: "relative",
                  padding: 0,
                  background: "#1a1a1a",
                  border: "1px solid #333",
                  borderRadius: 3,
                  cursor: "pointer",
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
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <video
                      src={urlFor(e)}
                      muted
                      preload="metadata"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
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
                    {e.scope === "global" ? "eng" : (e.stem ?? "").slice(0, 3)}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {entries && entries.length > 0 && (
            <div style={{ fontSize: 9, color: "#555", marginTop: 8, lineHeight: 1.4 }}>
              Click a tile to add it at the playhead. Shift+click copies the path. Drop files into
              public/assets/ for engine-wide, or projects/&lt;stem&gt;/images|videos/ per-track.
            </div>
          )}
        </>
      )}
    </div>
  );
};

const selectStyle: React.CSSProperties = {
  background: "#1a1a1a",
  border: "1px solid #333",
  borderRadius: 3,
  color: "#ddd",
  fontSize: 10,
  padding: "3px 4px",
  flex: 1,
  minWidth: 0,
};
