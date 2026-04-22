import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "../store";
import { stemFromAudioSrc } from "../utils/url";
import {
  assetKindLabel,
  assetMediaHint,
  assetPickerAccept,
  assetPreviewUrlFor,
  assetScopeLabel,
  assetUrlFor,
  detectAssetKindFromUpload,
  filterAndSortAssets,
  formatAssetBytes,
  formatAssetDuration,
  formatAssetTimestamp,
  type AssetKind,
  type AssetSortMode,
  type EditorAssetEntry as AssetEntry,
} from "../utils/assets";
import { isValidAssetId } from "../types/assetRecord";
import { loadAssetRegistry, saveAssetRegistry, findAssetByPath, findAssetById } from "../lib/assetRecordStore";
import { generateAssetId } from "../types/assetRecord";

export type AssetPickerKind = AssetKind;

type Props = {
  kind: AssetPickerKind;
  multi: boolean;
  initial: string[];
  onCommit: (paths: string[]) => void;
  onCancel: () => void;
};

type AssetPreviewMeta = {
  width?: number;
  height?: number;
  durationSec?: number;
};

const POLL_MS = 2000;

const mediaLabel = (kind: AssetPickerKind, count = 1): string =>
  `${assetKindLabel(kind)}${count === 1 ? "" : "s"}`;

const arraysEqual = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, idx) => value === b[idx]);

const rejectedUploadLabel = (rejectedKind: AssetKind | null, count: number): string => {
  if (!rejectedKind) return `${count} unsupported file${count === 1 ? "" : "s"}`;
  if (count === 1) return `1 ${assetKindLabel(rejectedKind)}`;
  return rejectedKind === "gif" ? `${count} GIFs` : `${count} ${assetKindLabel(rejectedKind)}s`;
};

const summarizeRejectedUploads = (
  expectedKind: AssetPickerKind,
  rejectedKinds: Array<AssetKind | null>,
): string | null => {
  if (rejectedKinds.length === 0) return null;

  const counts = new Map<AssetKind | null, number>();
  for (const rejectedKind of rejectedKinds) {
    counts.set(rejectedKind, (counts.get(rejectedKind) ?? 0) + 1);
  }

  const orderedKinds: Array<AssetKind | null> = ["image", "gif", "video", null];
  const summary = orderedKinds
    .filter((rejectedKind) => counts.has(rejectedKind))
    .map((rejectedKind) => rejectedUploadLabel(rejectedKind, counts.get(rejectedKind) ?? 0))
    .join(", ");

  return `Skipped ${summary}. This picker only imports ${mediaLabel(expectedKind, 2)}.`;
};

const useActiveAssetMeta = (asset: AssetEntry | null) => {
  const [meta, setMeta] = useState<AssetPreviewMeta | null>(null);

  useEffect(() => {
    if (!asset) {
      setMeta(null);
      return;
    }

    let cancelled = false;
    setMeta(null);

    if (asset.kind === "video") {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.src = assetUrlFor(asset);
      video.onloadedmetadata = () => {
        if (cancelled) return;
        setMeta({
          width: video.videoWidth || undefined,
          height: video.videoHeight || undefined,
          durationSec: Number.isFinite(video.duration) ? video.duration : undefined,
        });
      };
      video.onerror = () => {
        if (!cancelled) setMeta({});
      };
      return () => {
        cancelled = true;
      };
    }

    const img = new Image();
    img.src = assetPreviewUrlFor(asset);
    img.onload = () => {
      if (cancelled) return;
      setMeta({
        width: img.naturalWidth || undefined,
        height: img.naturalHeight || undefined,
      });
    };
    img.onerror = () => {
      if (!cancelled) setMeta({});
    };
    return () => {
      cancelled = true;
    };
  }, [asset]);

  return meta;
};

async function pathsToAssetIds(
  paths: string[],
  entriesByPath: Record<string, AssetEntry>,
  currentStem: string,
): Promise<string[]> {
  const registry = await loadAssetRegistry(currentStem);
  const assetIds: string[] = [];
  let registryChanged = false;

  for (const path of paths) {
    const entry = entriesByPath[path];
    if (!entry) continue;

    let record = findAssetByPath(registry, path);
    if (!record) {
      record = {
        id: generateAssetId(path),
        path,
        kind: entry.kind,
        scope: entry.scope,
        stem: entry.stem,
        sizeBytes: entry.size,
        mtimeMs: entry.mtime,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {},
        label: entry.label,
      };
      registry.push(record);
      registryChanged = true;
    }
    assetIds.push(record.id);
  }

  if (registryChanged) {
    await saveAssetRegistry(currentStem, registry);
  }

  return assetIds;
}

export const AssetPicker = ({ kind, multi, initial, onCommit, onCancel }: Props) => {
  const [entries, setEntries] = useState<AssetEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [initialResolved, setInitialResolved] = useState(false);
  const [scopeFilter, setScopeFilter] = useState<"all" | "global" | "project">("all");
  const [sortMode, setSortMode] = useState<AssetSortMode>("recent");
  const [search, setSearch] = useState("");
  const [importScope, setImportScope] = useState<"global" | "project">("global");
  const [dropActive, setDropActive] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [activePath, setActivePath] = useState<string | null>(initial[0] ?? null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const prevHashRef = useRef<string>("");
  const currentStem = useEditorStore((s) => stemFromAudioSrc(s.audioSrc));
  const elements = useEditorStore((s) => s.elements);

  useEffect(() => {
    setSelected(initial);
    setActivePath(initial[0] ?? null);
    setInitialResolved(true);
  }, [initial]);

  // When entries load, normalize any asset IDs in `selected` back to paths
  // so the picker UI (which indexes by path) stays consistent.
  useEffect(() => {
    if (!entries || !initialResolved) return;
    const hasAssetIds = selected.some((s) => isValidAssetId(s));
    if (!hasAssetIds) return;

    (async () => {
      if (!currentStem) return;
      try {
        const registry = await loadAssetRegistry(currentStem);
        const resolved = selected.map((s) => {
          if (!isValidAssetId(s)) return s;
          const record = findAssetById(registry, s);
          return record?.path ?? s;
        });
        setSelected(resolved);
        setActivePath(resolved[0] ?? null);
      } catch {
        // Leave as-is if registry unavailable
      }
    })();
  }, [entries, initialResolved, currentStem]);

  useEffect(() => {
    if (!currentStem && importScope === "project") setImportScope("global");
  }, [currentStem, importScope]);

  const hashEntries = useCallback((nextEntries: AssetEntry[]) => {
    let maxMtime = 0;
    for (const entry of nextEntries) {
      if (entry.mtime > maxMtime) maxMtime = entry.mtime;
    }
    return `${nextEntries.length}:${maxMtime}`;
  }, []);

  const refreshEntries = useCallback(async () => {
    try {
      const r = await fetch("/api/assets/list");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: AssetEntry[] = await r.json();
      prevHashRef.current = hashEntries(data);
      setEntries(data);
      setError(null);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
  }, [hashEntries]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const r = await fetch("/api/assets/list");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data: AssetEntry[] = await r.json();
        if (cancelled) return;
        const hash = hashEntries(data);
        if (hash === prevHashRef.current) {
          setError(null);
          return;
        }
        prevHashRef.current = hash;
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
  }, [hashEntries]);

  const entriesByPath = useMemo(
    () => Object.fromEntries((entries ?? []).map((entry) => [entry.path, entry])),
    [entries],
  );

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        if (!currentStem) {
          setError("No current project loaded. Cannot create asset records.");
          return;
        }

        try {
          const assetIds = await pathsToAssetIds(selected, entriesByPath, currentStem);
          onCommit(assetIds);
        } catch (err) {
          setError(`Failed to create asset records: ${String(err)}`);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, onCommit, onCancel, currentStem, entriesByPath]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    return filterAndSortAssets(entries, {
      kind,
      scope: scopeFilter,
      search,
      sort: sortMode,
    });
  }, [entries, kind, scopeFilter, search, sortMode]);

  useEffect(() => {
    if (activePath && entriesByPath[activePath]) return;
    const nextPath = selected.find((path) => entriesByPath[path]) ?? filtered[0]?.path ?? null;
    if (nextPath !== activePath) setActivePath(nextPath);
  }, [activePath, entriesByPath, filtered, selected]);

  const activeAsset = activePath ? entriesByPath[activePath] ?? null : null;
  const activeMeta = useActiveAssetMeta(activeAsset);

  const assetUsageCounts = useMemo(() => {
    const next: Record<string, number> = {};
    for (const element of elements) {
      for (const value of Object.values(element.props ?? {})) {
        if (typeof value === "string") {
          next[value] = (next[value] ?? 0) + 1;
          continue;
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === "string") next[item] = (next[item] ?? 0) + 1;
          }
        }
      }
    }
    return next;
  }, [elements]);

  const toggle = (path: string) => {
    setActivePath(path);
    if (multi) {
      setSelected((current) => (
        current.includes(path) ? current.filter((item) => item !== path) : [...current, path]
      ));
      return;
    }
    setSelected([path]);
  };

  const setOnlySelected = (path: string) => {
    setActivePath(path);
    setSelected([path]);
  };

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      /* clipboard access can fail outside a user gesture */
    }
  };

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
    const acceptedFiles: File[] = [];
    const rejectedKinds: Array<AssetKind | null> = [];
    for (const file of files) {
      const detectedKind = detectAssetKindFromUpload(file);
      if (detectedKind === kind) {
        acceptedFiles.push(file);
      } else {
        rejectedKinds.push(detectedKind);
      }
    }

    const rejectedMessage = summarizeRejectedUploads(kind, rejectedKinds);
    if (acceptedFiles.length === 0) {
      setError(rejectedMessage ?? `No ${mediaLabel(kind, 2)} were selected.`);
      setDropActive(false);
      return;
    }

    if (importScope === "project" && !currentStem) {
      setError("No current project is loaded, so Project import is unavailable.");
      setDropActive(false);
      return;
    }

    setUploading(acceptedFiles.length);
    setError(null);
    try {
      for (const file of acceptedFiles) {
        await uploadFile(file);
      }
      await refreshEntries();
      setScopeFilter(importScope);
      setSearch("");
      if (rejectedMessage) setError(rejectedMessage);
    } catch (err) {
      setError(`upload failed: ${String((err as Error)?.message ?? err)}`);
    } finally {
      setUploading(0);
      setDropActive(false);
    }
  };

  const deleteAsset = async (asset: AssetEntry) => {
    const usageCount = assetUsageCounts[asset.path] ?? 0;
    const warning =
      usageCount > 0
        ? `${asset.label} is currently referenced by ${usageCount} timeline element${usageCount === 1 ? "" : "s"}. Delete it anyway?`
        : `Delete ${asset.label}?`;
    if (!window.confirm(warning)) return;

    setDeletingPath(asset.path);
    try {
      const r = await fetch("/api/assets/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: asset.path }),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => `HTTP ${r.status}`);
        throw new Error(text);
      }
      setSelected((current) => current.filter((path) => path !== asset.path));
      if (activePath === asset.path) setActivePath(null);
      await refreshEntries();
    } finally {
      setDeletingPath(null);
    }
  };

  const selectionUnchanged = arraysEqual(selected, initial);
  const commitLabel =
    !multi && selectionUnchanged && selected.length > 0
      ? "Done"
      : multi
        ? `Use ${selected.length} selected`
        : `Use this ${assetKindLabel(kind)}`;

  const selectedAssetEntries = useMemo(
    () => selected.map((path) => entriesByPath[path]).filter((entry): entry is AssetEntry => Boolean(entry)),
    [entriesByPath, selected],
  );

  const selectionSummary = multi
    ? `${selected.length} ${mediaLabel(kind, selected.length || 2)} selected`
    : selectedAssetEntries[0]?.label ?? `(no ${assetKindLabel(kind)} chosen)`;

  const activeIsSelected = activeAsset ? selected.includes(activeAsset.path) : false;
  const activeUsageCount = activeAsset ? assetUsageCounts[activeAsset.path] ?? 0 : 0;
  const activeDimensionLabel =
    activeMeta?.width && activeMeta.height ? `${activeMeta.width}×${activeMeta.height}` : "";
  const activeMetaLabel = [
    activeDimensionLabel,
    activeAsset?.kind === "video" && activeMeta?.durationSec ? formatAssetDuration(activeMeta.durationSec) : "",
    activeAsset ? formatAssetBytes(activeAsset.size) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const segBtn = (active: boolean): React.CSSProperties => ({
    padding: "4px 8px",
    background: active ? "#2a4a7a" : "#171d25",
    border: `1px solid ${active ? "#3a6aaa" : "#2d3643"}`,
    color: active ? "#fff" : "#b3becf",
    fontSize: 11,
    borderRadius: 5,
    cursor: "pointer",
  });

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      onDragOver={(ev) => {
        if (ev.dataTransfer.types.includes("application/x-mv-asset")) return;
        if (!ev.dataTransfer.types.includes("Files")) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "copy";
        if (!dropActive) setDropActive(true);
      }}
      onDragLeave={(ev) => {
        if (ev.currentTarget === ev.target) setDropActive(false);
      }}
      onDrop={(ev) => {
        ev.preventDefault();
        setDropActive(false);
        if (ev.dataTransfer.types.includes("application/x-mv-asset")) return;
        void uploadFiles(Array.from(ev.dataTransfer.files ?? []));
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.76)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 500,
      }}
    >
      <div
        style={{
          width: "min(1100px, 96vw)",
          maxHeight: "90vh",
          background: "#0f1116",
          border: "1px solid #2a3240",
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          color: "#e5e8ef",
          boxShadow: "0 28px 90px rgba(0,0,0,0.5)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {uploading > 0 && (
          <div
            style={{
              position: "absolute",
              top: 12,
              right: 14,
              padding: "4px 8px",
              borderRadius: 999,
              background: "#152132",
              border: "1px solid #2d466d",
              color: "#d8e9ff",
              fontSize: 10,
              zIndex: 2,
            }}
          >
            Uploading {uploading}…
          </div>
        )}

        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid #262f3c",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 11, color: "#94a0b3", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Pick {mediaLabel(kind, multi ? 2 : 1)}
          </div>
          <div style={{ fontSize: 11, color: "#dbe4f2" }}>
            {filtered.length} shown{entries ? ` · ${entries.filter((entry) => entry.kind === kind).length} total` : ""}
          </div>
          <div style={{ fontSize: 10, color: "#7d8ba0" }}>
            {selectionSummary}
          </div>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => void refreshEntries()}
            style={{ ...segBtn(false), fontSize: 10 }}
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={onCancel}
            style={{ ...segBtn(false), fontSize: 10 }}
          >
            Close
          </button>
        </div>

        <div
          style={{
            padding: 14,
            borderBottom: "1px solid #262f3c",
            background: dropActive ? "#132033" : "#10151d",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={assetPickerAccept(kind)}
            onChange={(ev) => {
              const files = Array.from(ev.target.files ?? []);
              ev.currentTarget.value = "";
              void uploadFiles(files);
            }}
            style={{ display: "none" }}
          />

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 11, color: "#dce5f1", fontWeight: 700 }}>
              Import {mediaLabel(kind, 2)}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={() => setImportScope("global")}
                style={segBtn(importScope === "global")}
                title="Import into the shared library"
              >
                Library
              </button>
              <button
                type="button"
                onClick={() => currentStem && setImportScope("project")}
                disabled={!currentStem}
                style={{
                  ...segBtn(importScope === "project"),
                  opacity: currentStem ? 1 : 0.5,
                  cursor: currentStem ? "pointer" : "not-allowed",
                }}
                title={currentStem ? `Import into project ${currentStem}` : "Load a project to import project-local media"}
              >
                Project
              </button>
            </div>
            <div style={{ fontSize: 10, color: "#93a2b7" }}>
              Destination: {importScope === "project" && currentStem ? `project ${currentStem}` : "shared library"}
            </div>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={{
                ...segBtn(true),
                padding: "6px 10px",
                fontWeight: 700,
              }}
            >
              Choose Files
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={() => setScopeFilter("all")} style={segBtn(scopeFilter === "all")}>All scopes</button>
              <button type="button" onClick={() => setScopeFilter("global")} style={segBtn(scopeFilter === "global")}>Library</button>
              <button type="button" onClick={() => setScopeFilter("project")} style={segBtn(scopeFilter === "project")}>Project</button>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={() => setSortMode("recent")} style={segBtn(sortMode === "recent")}>Recent</button>
              <button type="button" onClick={() => setSortMode("name")} style={segBtn(sortMode === "name")}>Name</button>
              <button type="button" onClick={() => setSortMode("size")} style={segBtn(sortMode === "size")}>Size</button>
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Filter ${mediaLabel(kind, 2).toLowerCase()} by name or path…`}
              style={{
                flex: 1,
                minWidth: 180,
                background: "#0c1118",
                border: "1px solid #273243",
                color: "#edf2fb",
                padding: "7px 9px",
                borderRadius: 5,
                fontSize: 11,
              }}
            />
          </div>

          <div style={{ fontSize: 10, color: dropActive ? "#d8ebff" : "#8fa0b7", lineHeight: 1.45 }}>
            {dropActive
              ? `Drop files to import into ${importScope === "project" && currentStem ? `project ${currentStem}` : "the shared library"}.`
              : assetMediaHint(kind)}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 300px",
            minHeight: 0,
            flex: 1,
          }}
        >
          <div style={{ padding: 12, overflowY: "auto" }}>
            {error && (
              <div style={{ color: "#ff8c8c", fontSize: 11, marginBottom: 10 }}>
                {error}
              </div>
            )}
            {!entries && !error && (
              <div style={{ color: "#8d98aa", fontSize: 11 }}>Loading…</div>
            )}
            {entries && filtered.length === 0 && (
              <div style={{ color: "#8d98aa", fontSize: 11, fontStyle: "italic", padding: "12px 4px" }}>
                {entries.some((entry) => entry.kind === kind)
                  ? "No matches for the current filters."
                  : `No ${mediaLabel(kind, 2)} found. ${assetMediaHint(kind)}`}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(165px, 1fr))", gap: 10 }}>
              {filtered.map((entry) => {
                const isSelected = selected.includes(entry.path);
                const usageCount = assetUsageCounts[entry.path] ?? 0;
                return (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => toggle(entry.path)}
                    onDoubleClick={async () => {
                      if (!multi) {
                        if (!currentStem) {
                          onCommit([entry.path]);
                          return;
                        }
                        try {
                          const assetIds = await pathsToAssetIds([entry.path], entriesByPath, currentStem);
                          onCommit(assetIds);
                        } catch {
                          onCommit([entry.path]);
                        }
                      }
                    }}
                    style={{
                      border: `1px solid ${activePath === entry.path ? "#4b78b7" : isSelected ? "#3d648f" : "#2a3240"}`,
                      background: activePath === entry.path ? "#152131" : isSelected ? "#111a27" : "#131821",
                      borderRadius: 8,
                      padding: 6,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      textAlign: "left",
                    }}
                    title={`${entry.path}\n${formatAssetBytes(entry.size)} · ${formatAssetTimestamp(entry.mtime)}${usageCount > 0 ? `\nUsed in timeline: ${usageCount}` : ""}`}
                  >
                    <div style={{ position: "relative", background: "#000", borderRadius: 5, aspectRatio: "16 / 9", overflow: "hidden" }}>
                      <div style={{ position: "absolute", top: 6, left: 6, display: "flex", gap: 4, zIndex: 1 }}>
                        <span
                          style={{
                            fontSize: 8,
                            padding: "3px 5px",
                            borderRadius: 999,
                            background: "rgba(5, 8, 12, 0.84)",
                            border: "1px solid rgba(120, 132, 153, 0.45)",
                            color: "#eff4ff",
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                          }}
                        >
                          {entry.kind}
                        </span>
                        {usageCount > 0 && (
                          <span
                            style={{
                              fontSize: 8,
                              padding: "3px 5px",
                              borderRadius: 999,
                              background: "rgba(29, 57, 42, 0.92)",
                              border: "1px solid rgba(78, 151, 108, 0.5)",
                              color: "#dff7e7",
                            }}
                          >
                            used {usageCount}
                          </span>
                        )}
                      </div>
                      <div style={{ position: "absolute", top: 6, right: 6, zIndex: 1 }}>
                        <span
                          style={{
                            fontSize: 8,
                            padding: "3px 5px",
                            borderRadius: 999,
                            background: entry.scope === "global" ? "rgba(42, 74, 122, 0.88)" : "rgba(32, 98, 74, 0.88)",
                            border: "1px solid rgba(255,255,255,0.15)",
                            color: "#fff",
                          }}
                        >
                          {entry.scope === "global" ? "LIB" : "PROJ"}
                        </span>
                      </div>
                      {entry.kind === "video" ? (
                        <video
                          src={assetUrlFor(entry)}
                          muted
                          preload="metadata"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <img
                          src={assetPreviewUrlFor(entry)}
                          alt={entry.path}
                          loading="lazy"
                          onError={(ev) => {
                            const img = ev.currentTarget;
                            if (entry.kind === "gif" && img.src !== assetUrlFor(entry)) {
                              img.src = assetUrlFor(entry);
                            }
                          }}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <div style={{ fontSize: 11, color: "#eaf0fb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {entry.label}
                      </div>
                      <div style={{ fontSize: 10, color: "#7f8da3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {assetScopeLabel(entry.scope, entry.stem)}
                      </div>
                      <div style={{ fontSize: 10, color: "#7f8da3", display: "flex", justifyContent: "space-between", gap: 6 }}>
                        <span>{formatAssetBytes(entry.size)}</span>
                        <span>{isSelected ? "selected" : "click to select"}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div
            style={{
              borderLeft: "1px solid #262f3c",
              background: "#0c1017",
              padding: 12,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 11, color: "#dce5f1", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Asset Details
            </div>

            {activeAsset ? (
              <>
                <div style={{ background: "#050608", border: "1px solid #202733", borderRadius: 8, overflow: "hidden", aspectRatio: "1 / 1" }}>
                  {activeAsset.kind === "video" ? (
                    <video
                      src={assetUrlFor(activeAsset)}
                      muted
                      controls
                      preload="metadata"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <img
                      src={assetPreviewUrlFor(activeAsset)}
                      alt={activeAsset.path}
                      onError={(ev) => {
                        const img = ev.currentTarget;
                        if (activeAsset.kind === "gif" && img.src !== assetUrlFor(activeAsset)) {
                          img.src = assetUrlFor(activeAsset);
                        }
                      }}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 13, color: "#eef4fd", fontWeight: 700 }}>
                    {activeAsset.label}
                  </div>
                  <div style={{ fontSize: 10, color: "#8d9ab0", wordBreak: "break-word" }}>
                    {activeAsset.path}
                  </div>
                </div>

                <div
                  style={{
                    background: "#11161e",
                    border: "1px solid #232b37",
                    borderRadius: 8,
                    padding: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    fontSize: 10,
                    color: "#9eabbe",
                    lineHeight: 1.45,
                  }}
                >
                  <div><strong style={{ color: "#edf3fb" }}>Kind:</strong> {assetKindLabel(activeAsset.kind)}</div>
                  <div><strong style={{ color: "#edf3fb" }}>Scope:</strong> {assetScopeLabel(activeAsset.scope, activeAsset.stem)}</div>
                  <div><strong style={{ color: "#edf3fb" }}>Details:</strong> {activeMetaLabel || formatAssetBytes(activeAsset.size)}</div>
                  <div><strong style={{ color: "#edf3fb" }}>Modified:</strong> {formatAssetTimestamp(activeAsset.mtime)}</div>
                  <div><strong style={{ color: "#edf3fb" }}>Used in timeline:</strong> {activeUsageCount}</div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!multi) {
                        setOnlySelected(activeAsset.path);
                        return;
                      }
                      toggle(activeAsset.path);
                    }}
                    style={{
                      padding: "9px 10px",
                      background: activeIsSelected ? "#23364d" : "#21452f",
                      border: `1px solid ${activeIsSelected ? "#45688f" : "#2f7f49"}`,
                      borderRadius: 6,
                      color: activeIsSelected ? "#d8e9ff" : "#e2f7e8",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {multi ? (activeIsSelected ? "Remove From Selection" : "Add To Selection") : "Select This Asset"}
                  </button>

                  {multi && (
                    <button
                      type="button"
                      onClick={() => setOnlySelected(activeAsset.path)}
                      style={{
                        padding: "8px 10px",
                        background: "#17202a",
                        border: "1px solid #2d3948",
                        borderRadius: 6,
                        color: "#d8dfea",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      Use Only This Asset
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => void copyPath(activeAsset.path)}
                    style={{
                      padding: "8px 10px",
                      background: "#17202a",
                      border: "1px solid #2d3948",
                      borderRadius: 6,
                      color: "#d8dfea",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Copy Path
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void deleteAsset(activeAsset).catch((err) => {
                        setError(`delete failed: ${String((err as Error)?.message ?? err)}`);
                      });
                    }}
                    disabled={deletingPath === activeAsset.path}
                    style={{
                      padding: "8px 10px",
                      background: "#391818",
                      border: "1px solid #7a3030",
                      borderRadius: 6,
                      color: "#ffd7d7",
                      fontSize: 11,
                      cursor: deletingPath === activeAsset.path ? "wait" : "pointer",
                      opacity: deletingPath === activeAsset.path ? 0.7 : 1,
                    }}
                  >
                    {deletingPath === activeAsset.path ? "Deleting…" : "Delete Asset"}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 11, color: "#8995a8", lineHeight: 1.5 }}>
                Select an {assetKindLabel(kind)} to preview it, copy its path, or delete it.
              </div>
            )}

            {multi && selectedAssetEntries.length > 0 && (
              <div
                style={{
                  background: "#101620",
                  border: "1px solid #243142",
                  borderRadius: 8,
                  padding: 10,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 11, color: "#dce5f1", fontWeight: 700 }}>
                  Current Selection
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" }}>
                  {selectedAssetEntries.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      onClick={() => setActivePath(entry.path)}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        padding: "6px 8px",
                        background: activePath === entry.path ? "#162233" : "#0d1219",
                        border: "1px solid #243142",
                        borderRadius: 5,
                        color: "#d8e3f5",
                        fontSize: 10,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {entry.label}
                      </span>
                      <span style={{ color: "#8ea0b8" }}>
                        {formatAssetBytes(entry.size)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            padding: "10px 14px",
            borderTop: "1px solid #262f3c",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            alignItems: "center",
          }}
        >
          {multi && selected.length > 0 && (
            <button
              type="button"
              onClick={() => setSelected([])}
              style={{ ...segBtn(false), fontSize: 10 }}
            >
              Clear ({selected.length})
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            style={{ ...segBtn(false), fontSize: 10 }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!multi && selectionUnchanged && selected.length > 0) {
                onCancel();
                return;
              }

              if (!currentStem) {
                setError("No current project loaded. Cannot create asset records.");
                return;
              }

              try {
                const assetIds = await pathsToAssetIds(selected, entriesByPath, currentStem);
                onCommit(assetIds);
              } catch (err) {
                setError(`Failed to create asset records: ${String(err)}`);
              }
            }}
            disabled={selected.length === 0}
            style={{
              ...segBtn(selected.length > 0),
              fontSize: 10,
              cursor: selected.length > 0 ? "pointer" : "not-allowed",
              opacity: selected.length > 0 ? 1 : 0.55,
            }}
            title={!multi && selectionUnchanged ? "The current asset is already applied" : "⌘↩ also commits"}
          >
            {commitLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
