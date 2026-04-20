// editor/src/components/AssetPicker.tsx
//
// Modal for browsing engine-level + per-project image/video assets. Opens
// from SchemaEditor when editing a field that holds image or video paths
// (see SchemaEditor integration). Returns selected paths to the caller.

import { useEffect, useMemo, useState } from "react";

export type AssetEntry = {
  path: string;
  scope: "global" | "project";
  stem: string | null;
  kind: "image" | "video";
  size: number;
  mtime: number;
};

type Props = {
  kind: "image" | "video";
  multi: boolean;
  initial: string[];
  onCommit: (paths: string[]) => void;
  onCancel: () => void;
};

export const AssetPicker = ({ kind, multi, initial, onCommit, onCancel }: Props) => {
  const [entries, setEntries] = useState<AssetEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(initial);
  const [scopeFilter, setScopeFilter] = useState<"all" | "global" | "project">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/assets/list")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: AssetEntry[]) => {
        if (!cancelled) setEntries(data);
      })
      .catch((err) => { if (!cancelled) setError(String(err?.message ?? err)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onCommit(selected);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, onCommit, onCancel]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = search.toLowerCase();
    return entries.filter((e) => {
      if (e.kind !== kind) return false;
      if (scopeFilter !== "all" && e.scope !== scopeFilter) return false;
      if (q && !e.path.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, kind, scopeFilter, search]);

  const toggle = (p: string) => {
    if (multi) {
      setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
    } else {
      setSelected([p]);
    }
  };

  const thumbnailUrl = (e: AssetEntry) => `/api/projects/${e.path.replace(/^projects\//, "")}`;
  // "projects/<stem>/x.png" already works via /api/projects/<stem>/x.png;
  // "assets/images/x.png" needs a different endpoint (public/ is served by
  // Vite directly). Use /assets/... for those.
  const urlFor = (e: AssetEntry) =>
    e.path.startsWith("assets/") ? `/${e.path}` : thumbnailUrl(e);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 500,
      }}
    >
      <div
        style={{
          width: "min(720px, 92vw)",
          maxHeight: "84vh",
          background: "#0f0f0f",
          border: "1px solid #333",
          borderRadius: 6,
          display: "flex", flexDirection: "column",
          fontSize: 12, color: "#e5e5e5",
        }}
      >
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #333", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "#888" }}>
            Pick {kind}{multi ? "s" : ""}
          </span>
          <span style={{ color: "#666", fontSize: 10 }}>
            {filtered.length} available · {selected.length} selected
          </span>
          <div style={{ flex: 1 }} />
          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value as "all" | "global" | "project")}
            style={{ background: "#1a1a1a", border: "1px solid #333", color: "#ddd", padding: "3px 6px", borderRadius: 3, fontSize: 11 }}
          >
            <option value="all">All scopes</option>
            <option value="global">Global (engine)</option>
            <option value="project">Project</option>
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name…"
            style={{ background: "#1a1a1a", border: "1px solid #333", color: "#fff", padding: "3px 6px", borderRadius: 3, fontSize: 11, width: 160 }}
          />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
          {error && <div style={{ color: "#f66" }}>Error: {error}</div>}
          {!entries && !error && <div style={{ color: "#888" }}>Loading…</div>}
          {entries && filtered.length === 0 && (
            <div style={{ color: "#888", fontStyle: "italic", padding: 20 }}>
              No {kind}s found.{" "}
              {kind === "image"
                ? "Drop files into public/assets/images/ or projects/<stem>/images/"
                : "Drop files into public/assets/videos/ or projects/<stem>/videos/"}
              .
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
            {filtered.map((e) => {
              const isSelected = selected.includes(e.path);
              return (
                <button
                  key={e.path}
                  type="button"
                  onClick={() => toggle(e.path)}
                  title={`${e.path}\n${(e.size / 1024).toFixed(1)} KB\n${new Date(e.mtime).toLocaleString()}`}
                  style={{
                    position: "relative",
                    border: "2px solid " + (isSelected ? "#2196F3" : "#333"),
                    background: isSelected ? "#1e3a5f" : "#1a1a1a",
                    borderRadius: 4,
                    padding: 4,
                    cursor: "pointer",
                    display: "flex", flexDirection: "column", gap: 4,
                    textAlign: "left",
                  }}
                >
                  <div style={{ background: "#000", borderRadius: 2, aspectRatio: "16/9", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {e.kind === "image" ? (
                      <img src={urlFor(e)} alt={e.path} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <video src={urlFor(e)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} preload="metadata" />
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: "#ddd", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {e.path.split("/").pop()}
                  </div>
                  <div style={{ fontSize: 9, color: "#666", display: "flex", justifyContent: "space-between" }}>
                    <span>{e.scope === "global" ? "engine" : e.stem}</span>
                    <span>{(e.size / 1024).toFixed(0)} KB</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ padding: "10px 14px", borderTop: "1px solid #333", display: "flex", gap: 6, justifyContent: "flex-end" }}>
          {multi && selected.length > 0 && (
            <button
              onClick={() => setSelected([])}
              style={{ padding: "4px 10px", background: "#222", border: "1px solid #444", color: "#aaa", fontSize: 11, borderRadius: 3, cursor: "pointer" }}
            >
              Clear ({selected.length})
            </button>
          )}
          <button
            onClick={onCancel}
            style={{ padding: "4px 10px", background: "#222", border: "1px solid #444", color: "#ddd", fontSize: 11, borderRadius: 3, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={() => onCommit(selected)}
            disabled={selected.length === 0}
            style={{
              padding: "4px 10px",
              background: selected.length > 0 ? "#1a3a1a" : "#222",
              border: "1px solid " + (selected.length > 0 ? "#386" : "#444"),
              color: selected.length > 0 ? "#afa" : "#666",
              fontSize: 11, borderRadius: 3,
              cursor: selected.length > 0 ? "pointer" : "not-allowed",
            }}
            title="⌘↩ also commits"
          >
            {multi ? `Use ${selected.length} selected` : "Use this file"}
          </button>
        </div>
      </div>
    </div>
  );
};
