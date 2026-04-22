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

import { ELEMENT_MODULES, ELEMENT_REGISTRY } from "@compositions/elements/registry";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "../store";
import {
  applyAssetToModuleProps,
  assetKindLabel,
  assetPreviewUrlFor,
  assetScopeLabel,
  assetUrlFor,
  describeMediaFieldAction,
  filterAndSortAssets,
  findMediaFieldsForKind,
  formatAssetBytes,
  formatAssetDuration,
  mediaFieldLabel,
  moduleIdForAssetKind,
  seededPropsForModuleAsset,
  type AssetKind,
  type AssetSortMode,
  type EditorAssetEntry as AssetEntry,
} from "../utils/assets";
import type { TimelineElement } from "../types";
import { stemFromAudioSrc } from "../utils/url";
import { generateAssetId, isValidAssetId } from "../types/assetRecord";
import { loadAssetRegistry, saveAssetRegistry, findAssetByPath } from "../lib/assetRecordStore";

const POLL_MS = 2000;

// Click-to-add defaults. Swap these to change what type of element a click
// produces for each kind. The static-image module is the right default here
// because "I dropped a photo onto the timeline" should produce a photo on
// screen, not a beat-cycling sequence of one image.
const IMAGE_MODULE_ID = "overlay.staticImage";
const GIF_MODULE_ID = "overlay.gif";
const VIDEO_MODULE_ID = "overlay.speedVideo";

const newId = () => `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const countAssetReferences = (
  elements: readonly TimelineElement[],
  assetPath: string,
): number => {
  const assetId = generateAssetId(assetPath);
  let count = 0;
  for (const element of elements) {
    for (const value of Object.values(element.props ?? {})) {
      if (value === assetPath || value === assetId) {
        count += 1;
        continue;
      }
      if (Array.isArray(value) && (value.includes(assetPath) || value.includes(assetId))) {
        count += 1;
      }
    }
  }
  return count;
};

type AssetPreviewMeta = {
  width?: number;
  height?: number;
  durationSec?: number;
};

type AssetModuleAction = {
  moduleId: string;
  label: string;
  description: string;
  multi: boolean;
};

type SelectedElementAssetTarget = {
  name: string;
  fieldName: string;
  label: string;
  multi: boolean;
  alreadyHasAsset: boolean;
};

const compatibleModulesByKind: Record<AssetKind, AssetModuleAction[]> = (() => {
  const out: Record<AssetKind, AssetModuleAction[]> = {
    image: [],
    gif: [],
    video: [],
  };

  for (const mod of ELEMENT_MODULES) {
    const seenKinds = new Set<AssetKind>();
    for (const field of mod.mediaFields ?? []) {
      const kind = field.kind as AssetKind;
      if (seenKinds.has(kind)) continue;
      seenKinds.add(kind);
      out[kind].push({
        moduleId: mod.id,
        label: mod.label,
        description: mod.description,
        multi: Boolean(field.multi),
      });
    }
  }

  for (const kind of Object.keys(out) as AssetKind[]) {
    const defaultModuleId = moduleIdForAssetKind(kind);
    out[kind].sort((a, b) => {
      if (a.moduleId === defaultModuleId && b.moduleId !== defaultModuleId) return -1;
      if (b.moduleId === defaultModuleId && a.moduleId !== defaultModuleId) return 1;
      if (a.multi !== b.multi) return a.multi ? 1 : -1;
      return a.label.localeCompare(b.label);
    });
  }

  return out;
})();

const AssetUseModal = ({
  asset,
  modules,
  usageCount,
  selectedElementLabel,
  selectedElementTargets,
  onAddModule,
  onApplySelected,
  onCopyPath,
  onDeleteAsset,
  onClose,
}: {
  asset: AssetEntry;
  modules: readonly AssetModuleAction[];
  usageCount: number;
  selectedElementLabel: string | null;
  selectedElementTargets: readonly SelectedElementAssetTarget[];
  onAddModule: (moduleId: string) => void;
  onApplySelected: (fieldName: string) => void;
  onCopyPath: () => void;
  onDeleteAsset: () => void;
  onClose: () => void;
}) => {
  const previewUrl = assetPreviewUrlFor(asset);
  const hasSelectedElementTargets = selectedElementTargets.length > 0;

  return (
    <div
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 600,
      }}
    >
      <div
        style={{
          width: "min(760px, 94vw)",
          maxHeight: "88vh",
          overflowY: "auto",
          background: "#0f1013",
          border: "1px solid #2b3340",
          borderRadius: 8,
          boxShadow: "0 22px 80px rgba(0,0,0,0.55)",
        }}
      >
        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid #252c36",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 11, color: "#7f8ba0", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Use {assetKindLabel(asset.kind)}
          </div>
          <div style={{ color: "#d8dfeb", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {asset.label}
          </div>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "4px 8px",
              background: "#1a1d23",
              border: "1px solid #313846",
              borderRadius: 4,
              color: "#d3d9e2",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "220px minmax(0, 1fr)",
            gap: 14,
            padding: 14,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div
              style={{
                background: "#050608",
                border: "1px solid #232a34",
                borderRadius: 8,
                overflow: "hidden",
                aspectRatio: "1 / 1",
              }}
            >
              {asset.kind === "video" ? (
                <video
                  src={previewUrl}
                  muted
                  preload="metadata"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <img
                  src={previewUrl}
                  alt={asset.path}
                  onError={(ev) => {
                    const img = ev.currentTarget;
                    if (asset.kind === "gif" && img.src !== assetUrlFor(asset)) {
                      img.src = assetUrlFor(asset);
                    }
                  }}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              )}
            </div>
            <div
              style={{
                background: "#12161c",
                border: "1px solid #232a34",
                borderRadius: 6,
                padding: "9px 10px",
                fontSize: 10,
                color: "#94a0b4",
                lineHeight: 1.5,
              }}
            >
              <div><strong style={{ color: "#eef2f7" }}>Kind:</strong> {assetKindLabel(asset.kind)}</div>
              <div><strong style={{ color: "#eef2f7" }}>Scope:</strong> {assetScopeLabel(asset.scope, asset.stem)}</div>
              <div><strong style={{ color: "#eef2f7" }}>Used in timeline:</strong> {usageCount}</div>
              <div style={{ wordBreak: "break-word" }}>
                <strong style={{ color: "#eef2f7" }}>Path:</strong> {asset.path}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={onCopyPath}
                style={{
                  flex: 1,
                  padding: "7px 10px",
                  background: "#1a1d23",
                  border: "1px solid #2f3948",
                  borderRadius: 5,
                  color: "#d7dce6",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                Copy Path
              </button>
              <button
                type="button"
                onClick={onDeleteAsset}
                style={{
                  padding: "7px 10px",
                  background: "#3a1717",
                  border: "1px solid #7a3030",
                  borderRadius: 5,
                  color: "#ffd7d7",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                Delete
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                background: "#11161d",
                border: "1px solid #242c37",
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div style={{ fontSize: 11, color: "#dce4ef", fontWeight: 700, marginBottom: 8 }}>
                Selected Element
              </div>
              {selectedElementLabel ? (
                <>
                  <div style={{ fontSize: 11, color: "#91a0b6", marginBottom: 10 }}>
                    {selectedElementLabel}
                  </div>
                  {hasSelectedElementTargets ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {selectedElementTargets.map((target) => (
                        <button
                          key={target.fieldName}
                          type="button"
                          onClick={() => onApplySelected(target.fieldName)}
                          disabled={target.alreadyHasAsset}
                          style={{
                            padding: "8px 10px",
                            background: target.alreadyHasAsset ? "#1b2128" : "#1f4a2b",
                            border: `1px solid ${target.alreadyHasAsset ? "#313943" : "#2e7b48"}`,
                            borderRadius: 5,
                            color: target.alreadyHasAsset ? "#7f8a98" : "#dff7e7",
                            fontSize: 11,
                            cursor: target.alreadyHasAsset ? "not-allowed" : "pointer",
                            textAlign: "left",
                          }}
                        >
                          <div style={{ fontWeight: 700 }}>
                            {target.alreadyHasAsset ? `${target.label} already contains this asset` : describeMediaFieldAction(target)}
                          </div>
                          <div style={{ fontSize: 10, color: target.alreadyHasAsset ? "#6f7b8a" : "#b7d8c2", marginTop: 3 }}>
                            {target.multi
                              ? "Adds this asset to the selected element without removing existing media."
                              : "Replaces the selected element's current media path."}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 10, color: "#728094" }}>
                      The selected element does not accept {assetKindLabel(asset.kind)} media.
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 10, color: "#728094" }}>
                  No element selected. Choose one on the timeline if you want to replace or append media directly.
                </div>
              )}
            </div>

            <div
              style={{
                background: "#11161d",
                border: "1px solid #242c37",
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div style={{ fontSize: 11, color: "#dce4ef", fontWeight: 700, marginBottom: 8 }}>
                Add New Element
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {modules.map((moduleAction) => (
                  <button
                    key={moduleAction.moduleId}
                    type="button"
                    onClick={() => onAddModule(moduleAction.moduleId)}
                    style={{
                      padding: "9px 10px",
                      background: "#171d25",
                      border: "1px solid #2d3643",
                      borderRadius: 6,
                      color: "#e7edf6",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700 }}>
                      Add as {moduleAction.label}
                    </div>
                    <div style={{ fontSize: 10, color: "#8e9aaf", marginTop: 3 }}>
                      {moduleAction.description}
                      {moduleAction.multi ? " Appends this asset to a list-based media field." : ""}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
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
      const src = assetUrlFor(entry);
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
      } else if (entry.kind === "image" || entry.kind === "gif") {
        const img = new Image();
        img.src = assetPreviewUrlFor(entry);
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
  const [sortMode, setSortMode] = useState<AssetSortMode>("recent");
  const [importScope, setImportScope] = useState<"global" | "project">("global");
  const [actionAsset, setActionAsset] = useState<AssetEntry | null>(null);
  const prevHashRef = useRef<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const currentStem = useEditorStore((s) => stemFromAudioSrc(s.audioSrc));
  const selectedElementId = useEditorStore((s) => s.selectedElementId);
  const elements = useEditorStore((s) => s.elements);
  const metaMap = useAssetPreviewMeta(entries);
  const selectedElement = useMemo(
    () => elements.find((element) => element.id === selectedElementId) ?? null,
    [elements, selectedElementId],
  );
  const selectedModule = selectedElement ? ELEMENT_REGISTRY[selectedElement.type] ?? null : null;

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
    return filterAndSortAssets(entries, {
      kind: kindFilter,
      scope: scopeFilter,
      search,
      sort: sortMode,
    });
  }, [entries, kindFilter, scopeFilter, search, sortMode]);

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

  const assetUsageCounts = useMemo(() => {
    const next: Record<string, number> = {};
    const idToPath = new Map<string, string>();
    for (const element of elements) {
      for (const value of Object.values(element.props ?? {})) {
        if (typeof value === "string" && isValidAssetId(value)) {
          idToPath.set(value, value);
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === "string" && isValidAssetId(item)) {
              idToPath.set(item, item);
            }
          }
        }
      }
    }
    const normalizeKey = (s: string): string => {
      if (isValidAssetId(s)) return s;
      return s;
    };
    for (const element of elements) {
      for (const value of Object.values(element.props ?? {})) {
        if (typeof value === "string") {
          const key = normalizeKey(value);
          next[key] = (next[key] ?? 0) + 1;
          continue;
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === "string") {
              const key = normalizeKey(item);
              next[key] = (next[key] ?? 0) + 1;
            }
          }
        }
      }
    }
    return next;
  }, [elements]);

  const selectedElementCompatibleKinds = useMemo(
    () => new Set((selectedModule?.mediaFields ?? []).map((field) => field.kind as AssetKind)),
    [selectedModule],
  );

  const addElementForAsset = async (e: AssetEntry) => {
    const state = useEditorStore.getState();
    const insertion = resolveAssetInsertion(e);
    const modId = insertion.moduleId;
    const mod = ELEMENT_REGISTRY[modId];
    if (!mod) {
      setError(`element module ${modId} not found`);
      return;
    }

    // Generate/lookup asset ID for this path
    const { generateAssetId } = await import("../types/assetRecord");
    const { loadAssetRegistry, saveAssetRegistry, findAssetByPath } = await import("../lib/assetRecordStore");

    if (!currentStem) {
      setError("No current project loaded. Cannot create asset record.");
      return;
    }

    let assetId: string;
    try {
      const registry = await loadAssetRegistry(currentStem);
      let record = findAssetByPath(registry, e.path);

      if (!record) {
        assetId = generateAssetId(e.path);
        record = {
          id: assetId as `ast_${string}`,
          path: e.path,
          kind: e.kind,
          scope: e.scope,
          stem: e.stem,
          sizeBytes: e.size,
          mtimeMs: e.mtime,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          metadata: {},
          label: e.label,
        };
        registry.push(record);
        await saveAssetRegistry(currentStem, registry);
      } else {
        assetId = record.id;
      }
    } catch (err) {
      console.error("Failed to create/lookup asset record:", err);
      setError(`Failed to create asset record: ${String(err)}`);
      return;
    }

    const el: TimelineElement = {
      id: newId(),
      label: `${mod.label}: ${e.label}`,
      type: mod.id,
      trackIndex: mod.defaultTrack,
      startSec: Math.max(0, state.currentTimeSec),
      durationSec: mod.defaultDurationSec,
      props: seededPropsForModuleAsset(mod, e.kind, assetId),
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

  const addElementWithModule = async (asset: AssetEntry, moduleId: string) => {
    const state = useEditorStore.getState();
    const mod = ELEMENT_REGISTRY[moduleId];
    if (!mod) {
      setError(`element module ${moduleId} not found`);
      return;
    }

    // Generate/lookup asset ID for this path
    const { generateAssetId } = await import("../types/assetRecord");
    const { loadAssetRegistry, saveAssetRegistry, findAssetByPath } = await import("../lib/assetRecordStore");

    if (!currentStem) {
      setError("No current project loaded. Cannot create asset record.");
      return;
    }

    let assetId: ReturnType<typeof generateAssetId>;
    try {
      const registry = await loadAssetRegistry(currentStem);
      const record = findAssetByPath(registry, asset.path);

      if (!record) {
        // Create new record
        assetId = generateAssetId(asset.path);
        const newRecord = {
          id: assetId,
          path: asset.path,
          kind: asset.kind,
          scope: asset.scope,
          stem: asset.stem,
          sizeBytes: asset.size,
          mtimeMs: asset.mtime,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          metadata: {},
          label: asset.label,
        };
        registry.push(newRecord);
        await saveAssetRegistry(currentStem, registry);
      } else {
        assetId = record.id;
      }
    } catch (err) {
      console.error("Failed to create/lookup asset record:", err);
      setError(`Failed to create asset record: ${String(err)}`);
      return;
    }

    const el: TimelineElement = {
      id: newId(),
      label: `${mod.label}: ${asset.label}`,
      type: mod.id,
      trackIndex: mod.defaultTrack,
      startSec: Math.max(0, state.currentTimeSec),
      durationSec: mod.defaultDurationSec,
      props: seededPropsForModuleAsset(mod, asset.kind, assetId),
    };
    state.addElement(el);
    state.selectElement(el.id);
    setActionAsset(null);
  };

  const selectedElementTargetsForAsset = useCallback(
    (asset: AssetEntry | null): SelectedElementAssetTarget[] => {
      if (!asset || !selectedElement || !selectedModule) return [];
      const assetId = generateAssetId(asset.path);
      return findMediaFieldsForKind(selectedModule.mediaFields, asset.kind).map((field) => {
        const currentValue = selectedElement.props[field.name];
        const alreadyHasAsset = field.multi
          ? Array.isArray(currentValue) && (currentValue.includes(asset.path) || currentValue.includes(assetId))
          : currentValue === asset.path || currentValue === assetId;
        return {
          name: field.name,
          fieldName: field.name,
          label: mediaFieldLabel(field),
          multi: Boolean(field.multi),
          alreadyHasAsset,
        };
      });
    },
    [selectedElement, selectedModule],
  );

  const applyAssetToSelectedElement = async (asset: AssetEntry, fieldName: string) => {
    if (!selectedElement || !selectedModule) return;

    let valueToWrite: string;
    if (!currentStem) {
      valueToWrite = asset.path;
    } else {
      try {
        const registry = await loadAssetRegistry(currentStem);
        let record = findAssetByPath(registry, asset.path);
        if (!record) {
          record = {
            id: generateAssetId(asset.path),
            path: asset.path,
            kind: asset.kind,
            scope: asset.scope,
            stem: asset.stem,
            sizeBytes: asset.size,
            mtimeMs: asset.mtime,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            metadata: {},
            label: asset.label,
          };
          registry.push(record);
          await saveAssetRegistry(currentStem, registry);
        }
        valueToWrite = record.id;
      } catch {
        valueToWrite = asset.path;
      }
    }

    const nextProps = applyAssetToModuleProps(
      selectedModule,
      selectedElement.props,
      asset.kind,
      valueToWrite,
      fieldName,
    );
    useEditorStore.getState().updateElement(selectedElement.id, { props: nextProps });
    useEditorStore.getState().selectElement(selectedElement.id);
    setActionAsset(null);
  };

  const quickApplyAsset = (asset: AssetEntry) => {
    const targets = selectedElementTargetsForAsset(asset);
    const firstTarget = targets.find((target) => !target.alreadyHasAsset) ?? null;
    if (!firstTarget) {
      setActionAsset(asset);
      return;
    }
    void applyAssetToSelectedElement(asset, firstTarget.fieldName);
  };

  const selectedElementTargets = useMemo(
    () => selectedElementTargetsForAsset(actionAsset),
    [actionAsset, selectedElementTargetsForAsset],
  );

  const actionAssetUsageCount = useMemo(
    () => (actionAsset ? assetUsageCounts[actionAsset.path] ?? 0 : 0),
    [actionAsset, assetUsageCounts],
  );

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

  const deleteAsset = async (asset: AssetEntry) => {
    const usageCount = countAssetReferences(elements, asset.path);
    const warning =
      usageCount > 0
        ? `${asset.label} is currently referenced by ${usageCount} timeline element${usageCount === 1 ? "" : "s"}. Delete it anyway?`
        : `Delete ${asset.label}?`;
    if (!window.confirm(warning)) return;

    const r = await fetch("/api/assets/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: asset.path }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => `HTTP ${r.status}`);
      throw new Error(text);
    }
    await refreshEntries();
    setActionAsset(null);
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
          <div style={{ display: "flex", gap: 3, marginBottom: 6 }}>
            <button type="button" style={segBtn(sortMode === "recent")} onClick={() => setSortMode("recent")}>Recent</button>
            <button type="button" style={segBtn(sortMode === "name")} onClick={() => setSortMode("name")}>Name</button>
            <button type="button" style={segBtn(sortMode === "size")} onClick={() => setSortMode("size")}>Size</button>
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

          {selectedElement && (
            <div
              style={{
                marginBottom: 8,
                padding: "7px 8px",
                background: "#101620",
                border: "1px solid #243142",
                borderRadius: 5,
                fontSize: 10,
                color: "#b9c7db",
                lineHeight: 1.45,
              }}
            >
              <strong style={{ color: "#edf3fb" }}>Selected element:</strong> {selectedElement.label}
              {" · "}
              {selectedElementCompatibleKinds.size > 0
                ? "Use Apply on compatible assets to replace or append media directly."
                : "This element has no compatible media fields."}
            </div>
          )}

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
                const usageCount = assetUsageCounts[e.path] ?? 0;
                const canApplyToSelected = selectedElementCompatibleKinds.has(e.kind);
                const secondaryLabel = [
                  dimensionLabel,
                  e.kind === "video" && meta?.durationSec ? formatAssetDuration(meta.durationSec) : "",
                  formatAssetBytes(e.size),
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <div
                    key={e.path}
                    style={{
                      position: "relative",
                      padding: 0,
                      background: "linear-gradient(180deg, #171a1f 0%, #111318 100%)",
                      border: "1px solid #2f3540",
                      borderRadius: 6,
                      overflow: "hidden",
                      aspectRatio: "1 / 1",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <button
                      type="button"
                      draggable
                      onClick={(ev) => {
                        if (ev.shiftKey) {
                          void copyPath(e);
                          return;
                        }
                        void addElementForAsset(e);
                      }}
                      onDragStart={(ev) => onTileDragStart(e, ev)}
                      title={`${e.path}\n${formatAssetBytes(e.size)} · ${new Date(e.mtime).toLocaleString()}\nClick: add ${insertion.intentLabel} at playhead\nShift+click: copy path\nDrag: drop ${e.kind.toUpperCase()} onto a timeline track`}
                      style={{
                        all: "unset",
                        cursor: "grab",
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        minHeight: 0,
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
                          {usageCount > 0 && (
                            <span
                              style={{
                                fontSize: 8,
                                lineHeight: 1,
                                padding: "3px 4px",
                                borderRadius: 999,
                                background: "rgba(29, 57, 42, 0.9)",
                                color: "#dff7e7",
                                border: "1px solid rgba(78, 151, 108, 0.5)",
                              }}
                            >
                              used {usageCount}
                            </span>
                          )}
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
                            src={assetUrlFor(e)}
                            muted
                            preload="metadata"
                            style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
                          />
                        ) : (
                          <img
                            src={assetPreviewUrlFor(e)}
                            alt={e.path}
                            loading="lazy"
                            draggable={false}
                            onError={(ev) => {
                              const img = ev.currentTarget;
                              if (e.kind === "gif" && img.src !== assetUrlFor(e)) {
                                img.src = assetUrlFor(e);
                              }
                            }}
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
                          {e.label}
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
                          {secondaryLabel || assetScopeLabel(e.scope, e.stem)}
                        </span>
                      </div>
                    </button>
                    <div
                      style={{
                        padding: "0 6px 6px",
                        display: "flex",
                        gap: 4,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => (canApplyToSelected ? quickApplyAsset(e) : setActionAsset(e))}
                        style={{
                          ...segBtn(canApplyToSelected),
                          padding: "4px 6px",
                          flex: 1,
                          opacity: canApplyToSelected ? 1 : 0.65,
                        }}
                        title={canApplyToSelected
                          ? `Apply ${e.label} to the selected element`
                          : selectedElement
                            ? "Selected element cannot use this media kind"
                            : "Select an element to enable direct apply"}
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        onClick={() => setActionAsset(e)}
                        style={{
                          ...segBtn(false),
                          padding: "4px 6px",
                          flex: 1,
                        }}
                        title={`Manage ${e.label}`}
                      >
                        Manage
                      </button>
                    </div>
                  </div>
                );
              })()
            ))}
          </div>

          {entries && entries.length > 0 && (
            <div style={{ fontSize: 9, color: "#555", marginTop: 8, lineHeight: 1.4 }}>
              Click a preview to add the default media element at the playhead. Apply updates the selected element when it accepts that media kind. Manage exposes copy, delete, and module-specific insert actions. Shift+click copies the path. Drag onto a timeline track for precise placement.
            </div>
          )}
        </>
      )}
      {actionAsset && (
        <AssetUseModal
          asset={actionAsset}
          modules={compatibleModulesByKind[actionAsset.kind]}
          usageCount={actionAssetUsageCount}
          selectedElementLabel={selectedElement ? `${selectedElement.label} (${selectedModule?.label ?? selectedElement.type})` : null}
          selectedElementTargets={selectedElementTargets}
          onAddModule={(moduleId) => void addElementWithModule(actionAsset, moduleId)}
          onApplySelected={(fieldName) => void applyAssetToSelectedElement(actionAsset, fieldName)}
          onCopyPath={() => void copyPath(actionAsset)}
          onDeleteAsset={() => {
            void deleteAsset(actionAsset).catch((err) => {
              setError(`delete failed: ${String((err as Error)?.message ?? err)}`);
            });
          }}
          onClose={() => setActionAsset(null)}
        />
      )}
    </div>
  );
};
