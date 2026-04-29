import { getElementModule, getElementSourcePath } from "@compositions/elements/registry";
import { useElementDrag } from "../hooks/useElementDrag";
import { useElementResize } from "../hooks/useElementResize";
import { useEditorStore } from "../store";
import type { TimelineElement as TimelineElementType } from "../types";
import { openInEditor } from "../utils/openInEditor";

type Props = {
  element: TimelineElementType;
  pxPerSec: number;
  height: number;
};

// Category-based color, falls back to the old hard-coded map for legacy types.
const categoryColors: Record<string, string> = {
  text: "#3b82f6",
  audio: "#a855f7",
  shape: "#22c55e",
  overlay: "#f59e0b",
  video: "#ef4444",
};
const legacyColors: Record<string, string> = {
  text: "#3b82f6",
  image: "#60a5fa",
  effect: "#f59e0b",
  "beat-flash": "#ec4899",
};

const HANDLE_W = 8;
const MIN_BODY_W = 18;
const MIN_VISIBLE_BAR_W = HANDLE_W * 2 + MIN_BODY_W;

export const TimelineElement = ({ element, pxPerSec, height }: Props) => {
  const drag = useElementDrag(element.id, pxPerSec);
  const resizeL = useElementResize(element.id, pxPerSec, "left");
  const resizeR = useElementResize(element.id, pxPerSec, "right");
  const selectedElementId = useEditorStore((s) => s.selectedElementId);
  const selectElement = useEditorStore((s) => s.selectElement);
  const isSelected = selectedElementId === element.id;

  const mod = getElementModule(element.type);
  const color = mod
    ? (categoryColors[mod.category] ?? "#666")
    : (legacyColors[element.type] ?? "#666");

  const leftPx = element.startSec * pxPerSec;
  const widthPx = Math.max(MIN_VISIBLE_BAR_W, element.durationSec * pxPerSec);

  return (
    <div
      data-timeline-element="true"
      style={{
        position: "absolute",
        left: leftPx,
        top: 2,
        width: widthPx,
        height: height - 4,
        background: `linear-gradient(180deg, ${color}cc, ${color}99)`,
        border: isSelected ? "1.5px solid var(--accent)" : "1px solid rgba(0,0,0,0.25)",
        borderRadius: "var(--radius-xs)",
        display: "flex",
        alignItems: "center",
        fontSize: 10,
        fontFamily: "var(--font-ui)",
        color: "#fff",
        fontWeight: 500,
        overflow: "hidden",
        userSelect: "none",
        boxSizing: "border-box",
        boxShadow: isSelected ? "var(--shadow-glow-accent)" : "none",
        transition: "box-shadow var(--transition-fast), border-color var(--transition-fast)",
      }}
    >
      {/* Left resize handle */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-driven editor canvas; keyboard UI is separate */}
      <div
        onMouseDown={(e) => {
          resizeL.onMouseDown(e);
          selectElement(element.id);
        }}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: HANDLE_W,
          cursor: "ew-resize",
          background: isSelected ? "rgba(255,255,255,0.2)" : "transparent",
        }}
      />
      {/* Body — click/drag to move, click to select, double-click to open source */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-driven editor canvas; keyboard UI is separate */}
      <div
        onMouseDown={(e) => {
          drag.onMouseDown(e);
          selectElement(element.id);
        }}
        onDoubleClick={() => {
          const src = getElementSourcePath(element.type);
          if (src) void openInEditor(src);
        }}
        title={(() => {
          const src = getElementSourcePath(element.type);
          return src ? `${element.label} — double-click to open ${src}` : element.label;
        })()}
        style={{
          position: "absolute",
          left: HANDLE_W,
          right: HANDLE_W,
          top: 0,
          bottom: 0,
          cursor: "grab",
          paddingLeft: 4,
          paddingRight: 4,
          display: "flex",
          alignItems: "center",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          overflow: "hidden",
        }}
      >
        {element.label}
      </div>
      {/* Right resize handle */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-driven editor canvas; keyboard UI is separate */}
      <div
        onMouseDown={(e) => {
          resizeR.onMouseDown(e);
          selectElement(element.id);
        }}
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: HANDLE_W,
          cursor: "ew-resize",
          background: isSelected ? "rgba(255,255,255,0.2)" : "transparent",
        }}
      />
    </div>
  );
};
