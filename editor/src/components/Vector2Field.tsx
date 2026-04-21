// editor/src/components/Vector2Field.tsx
//
// Paired X/Y numeric control for 2D vectors — position (x,y), size (w,h),
// scale, anchor, etc. Two SharedNumericControl rows stacked, plus an
// optional crosshair preview that shows where on a 32×20 rectangle the
// current (x%, y%) lands.
//
// The link toggle (🔗) locks aspect ratio: editing one axis scales the
// other by the same ratio. Intended for SIZE pairs; position pairs leave
// it off by default so X and Y remain independent.
//
// Why a preview at all: for positions/anchors, seeing "0.5, 0.5" as a
// dot-in-rectangle is immediate — the dot is in the middle. Numbers
// alone force the user to mentally re-map to the canvas.

import { useRef } from "react";
import { SharedNumericControl } from "./SharedNumericControl";

type Props = {
  label: string;
  xValue: number;
  yValue: number;
  xMin: number; xMax: number; xStep: number;
  yMin: number; yMax: number; yStep: number;
  // When true, show the 🔗 icon; when the icon is pressed, editing one axis
  // scales the other by the same ratio. Default off.
  linkable?: boolean;
  // Crosshair rectangle with the current position. Default on — it's what
  // makes the control self-explanatory for positions.
  showPreview?: boolean;
  onChange: (x: number, y: number) => void;
};

// Clamp to [min, max] for crosshair positioning only. The actual value
// stored can exceed the range (SharedNumericControl allows soft overflow);
// the dot just pins to the rectangle edge in that case.
const pctWithin = (v: number, min: number, max: number): number => {
  if (!Number.isFinite(v)) return 50;
  const range = max - min;
  if (range <= 0) return 50;
  const pct = ((v - min) / range) * 100;
  return Math.max(0, Math.min(100, pct));
};

export const Vector2Field: React.FC<Props> = ({
  label,
  xValue,
  yValue,
  xMin, xMax, xStep,
  yMin, yMax, yStep,
  linkable = false,
  showPreview = true,
  onChange,
}) => {
  // Linked state lives in a ref+state pair: the ref captures the ratio at
  // the moment link was turned on, so later edits scale from that
  // baseline instead of drifting as both values change.
  const linkedRef = useRef<{ on: boolean; ratio: number }>({ on: false, ratio: 1 });

  const toggleLink = () => {
    linkedRef.current = {
      on: !linkedRef.current.on,
      // Snapshot ratio at toggle-on. Guard against /0 by falling back to 1.
      ratio: xValue !== 0 ? yValue / xValue : 1,
    };
    // Force rerender via a no-op onChange (pass same values) — simpler
    // than a dedicated useState when the link state only gates the icon
    // color and the onChange handlers below.
    onChange(xValue, yValue);
  };

  const onX = (x: number) => {
    if (linkedRef.current.on && x !== 0) {
      onChange(x, x * linkedRef.current.ratio);
    } else {
      onChange(x, yValue);
    }
  };
  const onY = (y: number) => {
    if (linkedRef.current.on && linkedRef.current.ratio !== 0) {
      // Derive X from Y using the inverse of the captured ratio so edits
      // to either axis remain consistent with the locked aspect.
      onChange(y / linkedRef.current.ratio, y);
    } else {
      onChange(xValue, y);
    }
  };

  const dotX = pctWithin(xValue, xMin, xMax);
  const dotY = pctWithin(yValue, yMin, yMax);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "4px 0",
        borderBottom: "1px solid #1a1a1a",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 11,
          color: "#aaa",
          textTransform: "capitalize",
          padding: "0 0 2px 0",
        }}
      >
        <span style={{ userSelect: "none" }}>{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {showPreview && (
            // Crosshair: 32×20 rectangle with a dot at (x%, y%). Background
            // matches the editor's dark panels; dot is the accent color.
            <div
              title={`x: ${xValue}, y: ${yValue}`}
              style={{
                position: "relative",
                width: 32,
                height: 20,
                background: "#0a0a0a",
                border: "1px solid #333",
                borderRadius: 2,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: `${dotX}%`,
                  top: `${dotY}%`,
                  width: 4,
                  height: 4,
                  marginLeft: -2,
                  marginTop: -2,
                  background: "#4a9",
                  borderRadius: "50%",
                  boxShadow: "0 0 2px #4a9",
                }}
              />
            </div>
          )}
          {linkable && (
            <button
              type="button"
              onClick={toggleLink}
              title={linkedRef.current.on ? "Unlink aspect ratio" : "Lock aspect ratio"}
              style={{
                width: 18,
                height: 18,
                padding: 0,
                background: linkedRef.current.on ? "#2a4a7a" : "#1a1a1a",
                border: `1px solid ${linkedRef.current.on ? "#4a9" : "#333"}`,
                borderRadius: 3,
                color: linkedRef.current.on ? "#ddd" : "#666",
                fontSize: 10,
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              {linkedRef.current.on ? "\u{1F517}" : "\u{1F517}\u{FE0E}"}
            </button>
          )}
        </div>
      </div>
      <SharedNumericControl
        label="x"
        value={xValue}
        min={xMin}
        max={xMax}
        step={xStep}
        onChange={onX}
      />
      <SharedNumericControl
        label="y"
        value={yValue}
        min={yMin}
        max={yMax}
        step={yStep}
        onChange={onY}
      />
    </div>
  );
};
