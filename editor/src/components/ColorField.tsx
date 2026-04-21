// editor/src/components/ColorField.tsx
//
// Replacement for the bare <input type="color"> — that native control is
// tiny, has no HEX readout, and loses recent-color history across sessions.
//
// Layout (compact row):
//   [swatch]  [#ff0088  ]  [↺]
//      ↑           ↑         ↑
//   click = open   HEX       reset (only if defaultValue prop given)
//   popover        input
//
// Popover (absolute-positioned under the row):
//   • large native <input type="color"> (48×48) for drag-picking
//   • HEX input validated on blur/Enter — accepts #rgb / #rrggbb / #rrggbbaa
//   • 8 recent-colors swatches, persisted in localStorage
//
// Recent-colors persistence key: "mv-editor-recent-colors". Stored as a
// JSON array; newest first; deduped; capped at 8.

import { useEffect, useRef, useState } from "react";

type Props = {
  label: string;
  value: string;
  defaultValue?: string;
  onChange: (hex: string) => void;
};

const RECENT_KEY = "mv-editor-recent-colors";
const RECENT_MAX = 8;
// Matches #rgb, #rrggbb, #rrggbbaa (case-insensitive). Alpha is preserved
// when present; the native color picker drops it but HEX input keeps it.
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const readRecent = (): string[] => {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s) => typeof s === "string" && HEX_RE.test(s)).slice(0, RECENT_MAX);
  } catch {
    return [];
  }
};

const writeRecent = (list: string[]): void => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // Quota/private-mode: silently ignore; recent colors are nice-to-have.
  }
};

// Normalize #rgb → #rrggbb so the native color input accepts it and our
// stored history is consistent. Pass through 6/8-digit unchanged.
const normalizeHex = (hex: string): string => {
  const h = hex.trim();
  if (!HEX_RE.test(h)) return h;
  if (h.length === 4) {
    // #rgb → #rrggbb
    return (
      "#" +
      h[1] + h[1] +
      h[2] + h[2] +
      h[3] + h[3]
    ).toLowerCase();
  }
  return h.toLowerCase();
};

// Native <input type="color"> accepts only #rrggbb. Strip alpha for it,
// then re-apply alpha on commit if the user had typed an 8-digit hex.
const stripAlpha = (hex: string): string => {
  if (hex.length === 9) return hex.slice(0, 7);
  return hex;
};

export const ColorField: React.FC<Props> = ({ label, value, defaultValue, onChange }) => {
  const [open, setOpen] = useState(false);
  const [hexInput, setHexInput] = useState(value);
  const [recent, setRecent] = useState<string[]>(() => readRecent());
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Keep the HEX input in sync with incoming value changes (e.g. undo).
  useEffect(() => {
    setHexInput(value);
  }, [value]);

  // Click-outside: close popover when a pointerdown lands outside the
  // component root. pointerdown (not click) so dragging the native color
  // input doesn't register as a close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const commitColor = (next: string) => {
    const normalized = normalizeHex(next);
    if (!HEX_RE.test(normalized)) return;
    onChange(normalized);
    // Push to recent: dedupe + newest-first + cap.
    setRecent((prev) => {
      const without = prev.filter((c) => c.toLowerCase() !== normalized.toLowerCase());
      const next = [normalized, ...without].slice(0, RECENT_MAX);
      writeRecent(next);
      return next;
    });
  };

  const onHexCommit = () => {
    if (HEX_RE.test(hexInput.trim())) {
      commitColor(hexInput.trim());
    } else {
      // Invalid: snap back to the authoritative value.
      setHexInput(value);
    }
  };

  // Native color input always emits #rrggbb. Fire immediately on change
  // so the picker feels live, but only push to recent on popover close
  // (see onPointerUp below) to avoid flooding history with every tick.
  const onNativeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setHexInput(next);
    onChange(next);
  };

  const onNativeCommit = () => {
    // Final tick from native picker — now it's worth pushing to recent.
    if (HEX_RE.test(hexInput)) {
      setRecent((prev) => {
        const without = prev.filter((c) => c.toLowerCase() !== hexInput.toLowerCase());
        const next = [hexInput, ...without].slice(0, RECENT_MAX);
        writeRecent(next);
        return next;
      });
    }
  };

  return (
    <div
      ref={rootRef}
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "80px auto 1fr auto",
        gap: 6,
        alignItems: "center",
        padding: "3px 0",
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: "#aaa",
          userSelect: "none",
          textTransform: "capitalize",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${label}: click to open color picker`}
        style={{
          width: 24,
          height: 24,
          padding: 0,
          background: value,
          border: `1px solid ${open ? "#4a9" : "#333"}`,
          borderRadius: 3,
          cursor: "pointer",
          boxSizing: "border-box",
        }}
      />
      <input
        type="text"
        value={hexInput}
        onChange={(e) => setHexInput(e.target.value)}
        onBlur={onHexCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.currentTarget.blur(); }
          else if (e.key === "Escape") { setHexInput(value); e.currentTarget.blur(); }
        }}
        title="HEX: #rgb, #rrggbb, or #rrggbbaa. Enter to commit, Esc to cancel."
        style={{
          width: "100%",
          padding: "3px 5px",
          background: "#1a1a1a",
          border: `1px solid ${HEX_RE.test(hexInput.trim()) ? "#333" : "#a44"}`,
          borderRadius: 3,
          color: "#ddd",
          fontSize: 11,
          fontFamily: "monospace",
          boxSizing: "border-box",
        }}
      />
      {defaultValue !== undefined && (
        <button
          type="button"
          onClick={() => commitColor(defaultValue)}
          title={`Reset to ${defaultValue}`}
          disabled={value.toLowerCase() === defaultValue.toLowerCase()}
          style={{
            width: 20,
            height: 20,
            padding: 0,
            background: "#1a1a1a",
            border: "1px solid #333",
            borderRadius: 3,
            color: value.toLowerCase() === defaultValue.toLowerCase() ? "#444" : "#ddd",
            cursor: value.toLowerCase() === defaultValue.toLowerCase() ? "default" : "pointer",
            fontSize: 11,
            lineHeight: 1,
          }}
        >
          {"\u21BA"}
        </button>
      )}
      {open && (
        // Popover: absolute-positioned under the row. gridColumn spans the
        // whole row so it lines up regardless of column widths.
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 86,
            zIndex: 100,
            marginTop: 4,
            padding: 8,
            background: "#1a1a1a",
            border: "1px solid #333",
            borderRadius: 4,
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minWidth: 180,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="color"
              // Native picker can't render alpha — strip it for the input,
              // but the HEX input above still preserves the alpha channel.
              value={stripAlpha(HEX_RE.test(value) ? normalizeHex(value) : "#000000")}
              onChange={onNativeChange}
              onBlur={onNativeCommit}
              style={{
                width: 48,
                height: 48,
                padding: 0,
                background: "transparent",
                border: "1px solid #333",
                borderRadius: 3,
                cursor: "pointer",
              }}
            />
            <div style={{ flex: 1, fontSize: 10, color: "#666", lineHeight: 1.4 }}>
              Drag the native picker, or type a HEX above. Supports alpha via
              #rrggbbaa.
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>Recent</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 3 }}>
              {Array.from({ length: RECENT_MAX }).map((_, i) => {
                const c = recent[i];
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => c && commitColor(c)}
                    disabled={!c}
                    title={c ?? "empty slot"}
                    style={{
                      width: "100%",
                      aspectRatio: "1 / 1",
                      background: c ?? "#0a0a0a",
                      border: `1px solid ${c ? "#333" : "#222"}`,
                      borderRadius: 2,
                      padding: 0,
                      cursor: c ? "pointer" : "default",
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
