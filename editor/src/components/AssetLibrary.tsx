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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "../store";
import {
  seededPropsForModuleAsset,
  type AssetKind,
  type EditorAssetEntry as AssetEntry,
} from "../utils/assets";
import type { TimelineElement } from "../types";
import { stemFromAudioSrc } from "../utils/url";

const POLL_MS = 2000;

// Click-to-add defaults. Swap these to change what type of element a click
// produces for each kind. The static-image module is the right default here
// because "I dropped a photo onto the timeline" should produce a photo on
// screen, not a beat-cycling sequence of one image.
const IMAGE_MODULE_ID = "overlay.staticImage";
const GIF_MODULE_ID = "overlay.gif";
const VIDEO_MODULE_ID = "overlay.speedVideo";

const newId = () => `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const urlFor = (e: AssetEntry): string =>
  e.path.startsWith("assets/") ? `/${e.path}` : `/api/projects/${e.path.replace(/^projects\//, "")}`;

const kbLabel = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`;

const durationLabel = (sec: number): string => {
  if (!Number.isFinite(sec) || sec <= 0) return "";
  if (sec < 10) return `${sec.toFixed(1)}s`;
  if (sec < 60) return `${Math.round(sec)}s`;
  const mins = Math.floor(sec / 60);
  const rem = Math.round(sec % 60).toString().padStart(2, "0");
  return `${mins}:${rem}`;
};

type AssetPreviewMeta = {
  width?: number;
  height?: number;
  durationSec?: number;
};

// Cheap content hash over the entries list. We only need to notice when the
// set of files changed (new / removed / touched). Counting + max-mtime is
// sufficient and avoids JSON.stringify on every poll.
const hashEntries = (es: AssetEntry[]): string => {
  let maxM = 0;
  for (const e of es) if (e.mtime > maxM) maxM = e.mtime;
  return `${es.length}:${maxM}`;
};

const resolveAssetInsertion = (asset: Pick<AssetEntry, "path" | "kind">) => {
  if (asset.kind === "gif") {
    return {
      moduleId: GIF_MODULE_ID,
      intentLabel: "GIF clip",
    };
  }
  if (asset.kind === "image") {
    return {
      moduleId: IMAGE_MODULE_ID,
      intentLabel: "image",
    };
  }
  return {
    moduleId: VIDEO_MODULE_ID,
    intentLabel: "video",
  };
};

const useAssetPreviewMeta = (entries: AssetEntry[] | null) => {
  const [metaMap, setMetaMap] = useState<Record<string, AssetPreviewMeta>>({});

  useEffect(() => {
    if (!entries || entries.length === 0) return;
    let cancelled = false;
    for (const entry of entries) {
      if (metaMap[entry.path]) continue;
      const src = urlFor(entry);
      if (entry.kind === "video") {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.src = src;
        video.onloadedmetadata = () => {
          if (cancelled) return;
          setMetaMap((prev) => (
            prev[entry.path]
              ? prev
              : {
                  ...prev,
                  [entry.path]: {
                    width: video.videoWidth || undefined,
                    height: video.videoHeight || undefined,
                    durationSec: Number.isFinite(video.duration) ? video.duration : undefined,
                  },
                }
          ));
        };
        video.onerror = () => {
          if (cancelled) return;
          setMetaMap((prev) => (prev[entry.path] ? prev : { ...prev, [entry.path]: {} }));
        };
      } else {
        const img = new Image();
        img.src = src;
        img.onload = () => {
          if (cancelled) return;
          setMetaMap((prev) => (
            prev[entry.path]
              ? prev
              : {
                  ...prev,
                  [entry.path]: {
                    width: img.naturalWidth || undefined,
                    height: img.naturalHeight || undefined,
                  },
                }
          ));
        };
        img.onerror = () => {
          if (cancelled) return;
          setMetaMap((prev) => (prev[entry.path] ? prev : { ...prev, [entry.path]: {} }));
        };
      }
    }
    return () => {
      cancelled = true;
    };
  }, [entries, metaMap]);

  return metaMap;
};

export const AssetLibrary = () => {
  const [entries, setEntries] = useState<AssetEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [scopeFilter, setScopeFilter] = useState<"all" | "global" | "project">("all");
  const [kindFilter, setKindFilter] = useState<"all" | AssetKind>("all");
  const [search, setSearch] = useState("");
  const [importScope, setImportScope] = useState<"global" | "project">("global");
  const prevHashRef = useRef<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const currentStem = useEditorStore((s) => stemFromAudioSrc(s.audioSrc));
  const metaMap = useAssetPreviewMeta(entries);

  useEffect(() => {
    if (!currentStem && importScope === "project") setImportScope("global");
  }, [currentStem, importScope]);

  const refreshEntries = useCallback(async () => {
    try {
      const r = await fetch("/api/assets/list");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: AssetEntry[] = await r.json();
      const h = hashEntries(data);
      prevHashRef.current = h;
      setEntries(data);
      setError(null);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
  }, []);

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

  const counts = useMemo(() => {
    const source = entries ?? [];
    return source.reduce(
      (acc, entry) => {
        acc.total += 1;
        if (entry.scope === "global") acc.global += 1;
        else acc.project += 1;
        return acc;
      },
      { total: 0, global: 0, project: 0 },
    );
  }, [entries]);

  const addElementForAsset = (e: AssetEntry) => {
    const state = useEditorStore.getState();
    const insertion = resolveAssetInsertion(e);
    const modId = insertion.moduleId;
    const mod = ELEMENT_REGISTRY[modId];
    if (!mod) {
      setError(`element module ${modId} not found`);
      return;
    }
    const el: TimelineElement = {
      id: newId(),
      label: `${mod.label}: ${e.path.split("/").pop()}`,
      type: mod.id,
      trackIndex: mod.defaultTrack,
      startSec: Math.max(0, state.currentTimeSec),
      durationSec: mod.defaultDurationSec,
      props: seededPropsForModuleAsset(mod, e.kind, e.path),
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

  // Import surface: OS drag-drop or file picker. Upload destination is a
  // first-class choice now: shared Library vs current Project.
  const [dropActive, setDropActive] = useState(false);
  const [uploading, setUploading] = useState(0);

  const uploadUrl =
    importScope === "project" && currentStem
      ? `/api/assets/upload?scope=project&stem=${encodeURIComponent(currentStem)}`
      : "/api/assets/upload?scope=global";

  const uploadFile = async (file: File): Promise<void> => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    const r = await fetch(uploadUrl, { method: "POST", body: fd });
    if (!r.ok) {
      const text = await r.text().catch(() => `HTTP ${r.status}`);
      throw new Error(text);
    }
  };

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (importScope === "project" && !currentStem) {
      setError("No current project is loaded, so Project import is unavailable.");
      return;
    }
    setUploading(files.length);
    setError(null);
    try {
      for (const f of files) {
        await uploadFile(f);
      }
      await refreshEntries();
      setScopeFilter(importScope);
      setSearch("");
    } catch (err) {
      setError(`upload failed: ${String(err)}`);
    } finally {
      setUploading(0);
    }
  };

  const handleOsDrop = async (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    setDropActive(false);
    // Ignore our own intra-app tile drags (they carry x-mv-asset).
    if (ev.dataTransfer.types.includes("application/x-mv-asset")) return;
    const files = Array.from(ev.dataTransfer.files ?? []);
    await uploadFiles(files);
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

  const openFilePicker = () => fileInputRef.current?.click();

  const handleFileInputChange = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(ev.target.files ?? []);
    ev.currentTarget.value = "";
    await uploadFiles(files);
  };

  const header = (
    <button
      type="button"
      onClick={() => setCollapsed((c) => !c)}
      style={{
        all: "unset",
        display: "flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        margin: "0 0 10px 0",
        padding: "6px 8px",
        background: "#2a4a7a",
        borderRadius: 4,
        width: "calc(100% - 16px)",
      }}
      title={collapsed ? "Expand media library" : "Collapse media library"}
    >
      <span style={{ fontSize: 11, color: "#fff", width: 10 }}>{collapsed ? "▶" : "▼"}</span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "#fff",
          letterSpacing: "0.08em",
        }}
      >
        MEDIA LIBRARY
      </span>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 10, color: "#cfd8e8" }}>
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

  const filterSummary =
    filtered.length === (entries?.length ?? 0)
      ? `${filtered.length} media item${filtered.length === 1 ? "" : "s"}`
      : `${filtered.length} of ${entries?.length ?? 0} shown`;

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
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,.gif"
            onChange={handleFileInputChange}
            style={{ display: "none" }}
          />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              marginBottom: 10,
              padding: "10px",
              background: dropActive ? "#18263a" : "#11161d",
              border: `1px solid ${dropActive ? "#4d7ed1" : "#2a3340"}`,
              borderRadius: 6,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 10, color: "#d7deea", fontWeight: 700, letterSpacing: "0.06em" }}>
                IMPORT MEDIA
              </div>
              <div style={{ fontSize: 9, color: "#7f8aa0" }}>
                {counts.total > 0 ? `${counts.global} lib · ${counts.project} proj` : "empty library"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                type="button"
                style={segBtn(importScope === "global")}
                onClick={() => setImportScope("global")}
                title="Import into the shared library"
              >
                Library
              </button>
              <button
                type="button"
                style={{
                  ...segBtn(importScope === "project"),
                  opacity: currentStem ? 1 : 0.5,
                  cursor: currentStem ? "pointer" : "not-allowed",
                }}
                disabled={!currentStem}
                onClick={() => setImportScope("project")}
                title={currentStem ? `Import into ${currentStem}` : "Load a project to import project-local media"}
              >
                Project
              </button>
            </div>
            <div
              style={{
                fontSize: 10,
                color: "#c2cadd",
                background: "#0e1218",
                border: "1px solid #202a36",
                borderRadius: 4,
                padding: "6px 7px",
                lineHeight: 1.4,
              }}
            >
              <strong style={{ color: "#fff" }}>Destination:</strong>{" "}
              {importScope === "project" && currentStem ? `project ${currentStem}` : "shared library"}
            </div>
            <button
              type="button"
              onClick={openFilePicker}
              style={{
                padding: "7px 8px",
                background: "#2a4a7a",
                border: "1px solid #3a6aaa",
                borderRadius: 4,
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Choose Files
            </button>
            <div style={{ fontSize: 10, color: "#8f9bb0", lineHeight: 1.4 }}>
              {dropActive
                ? `Drop files to import into ${importScope === "project" && currentStem ? `project ${currentStem}` : "the shared library"}.`
                : `Drag MP4, GIF, PNG, JPG and similar media here, or use Choose Files. Destination: ${importScope === "project" && currentStem ? `project ${currentStem}` : "shared library"}.`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 3, marginBottom: 4 }}>
            <button type="button" style={segBtn(kindFilter === "all")} onClick={() => setKindFilter("all")}>All</button>
            <button type="button" style={segBtn(kindFilter === "image")} onClick={() => setKindFilter("image")}>Img</button>
            <button type="button" style={segBtn(kindFilter === "gif")} onClick={() => setKindFilter("gif")}>GIF</button>
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
            placeholder="Filter by filename or path…"
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
                ? "No media yet. Import files above, or place them in public/assets/{images,gifs,videos}/ or projects/<stem>/{images,gifs,videos}/."
                : "No matches for current filters."}
            </div>
          )}

          {entries && entries.length > 0 && (
            <div style={{ fontSize: 9, color: "#667286", marginBottom: 8 }}>
              {filterSummary}
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
              (() => {
                const insertion = resolveAssetInsertion(e);
                const meta = metaMap[e.path];
                const dimensionLabel =
                  meta?.width && meta?.height ? `${meta.width}×${meta.height}` : "";
                const secondaryLabel = [dimensionLabel, e.kind === "video" && meta?.durationSec ? durationLabel(meta.durationSec) : "", kbLabel(e.size)]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <button
                    key={e.path}
                    type="button"
                    draggable
                    onClick={(ev) => handleTileClick(e, ev.shiftKey)}
                    onDragStart={(ev) => onTileDragStart(e, ev)}
                    title={`${e.path}\n${kbLabel(e.size)} · ${new Date(e.mtime).toLocaleString()}\nClick: add ${insertion.intentLabel} at playhead\nShift+click: copy path\nDrag: drop ${e.kind.toUpperCase()} onto a timeline track`}
                    style={{
                      position: "relative",
                      padding: 0,
                      background: "linear-gradient(180deg, #171a1f 0%, #111318 100%)",
                      border: "1px solid #2f3540",
                      borderRadius: 6,
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
                      <div
                        style={{
                          position: "absolute",
                          top: 4,
                          left: 4,
                          display: "flex",
                          gap: 4,
                          zIndex: 1,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 8,
                            lineHeight: 1,
                            padding: "3px 4px",
                            borderRadius: 999,
                            background: "rgba(5, 8, 12, 0.82)",
                            color: "#f2f5f8",
                            border: "1px solid rgba(100, 113, 132, 0.45)",
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                          }}
                        >
                          {e.kind}
                        </span>
                      </div>
                      <div
                        style={{
                          position: "absolute",
                          top: 4,
                          right: 4,
                          zIndex: 1,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 8,
                            lineHeight: 1,
                            padding: "3px 4px",
                            borderRadius: 999,
                            background: e.scope === "global" ? "rgba(42, 74, 122, 0.88)" : "rgba(32, 98, 74, 0.88)",
                            color: "#fff",
                            border: "1px solid rgba(255,255,255,0.15)",
                            letterSpacing: "0.04em",
                          }}
                        >
                          {e.scope === "global" ? "LIB" : "PROJ"}
                        </span>
                      </div>
                      {e.kind === "video" ? (
                        <video
                          src={urlFor(e)}
                          muted
                          preload="metadata"
                          style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
                        />
                      ) : (
                        <img
                          src={urlFor(e)}
                          alt={e.path}
                          draggable={false}
                          style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
                        />
                      )}
                    </div>
                    <div
                      style={{
                        padding: "5px 6px",
                        borderTop: "1px solid #232932",
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                        textAlign: "left",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 9,
                          color: "#d7dce6",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {e.path.split("/").pop()}
                      </span>
                      <span
                        style={{
                          fontSize: 8,
                          color: "#697384",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {secondaryLabel || (e.scope === "global" ? "Shared library" : `Project ${e.stem ?? ""}`)}
                      </span>
                    </div>
                  </button>
                );
              })()
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
