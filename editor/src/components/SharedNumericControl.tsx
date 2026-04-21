// editor/src/components/SharedNumericControl.tsx
//
// Framer/Figma/AE-style numeric field. The whole row is a small widget:
//
//   [drag-label]  [─────◉────]  [  12.50 ]
//       ↑              ↑             ↑
//   pointerdown-       slider        number input;
//   drag horizontal    (range)       accepts math (+10, *2, /4)
//   to scrub value.
//
// Modifiers:
//   shift = 10× SLOWER (fine)   alt = 10× FASTER (coarse)
//
// Zod introspection pulls .min/.max/.step. If absent, falls back to
// heuristic defaults based on field name (opacity-ish → 0..1 step 0.01;
// size-ish → 0..400 step 1; time-ish → 0..30 step 0.1).
//
// Why label-drag: the default <input type="number"> spinner changes by
// the .step value per click — usable but slow. Drag scrubbing lets a
// user go from 12 to 120 by dragging 108 pixels. It's the single
// interaction that separates "real editor" from "form with spinners."

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  // Optional: override how many pixels of horizontal drag = one `step`.
  // Defaults to 2 px/step — a full slider range in ~300-600 px of drag.
  pxPerStep?: number;
  integer?: boolean;
  // Optional schema default. When provided AND value !== defaultValue, a
  // tiny ↺ reset affordance appears at the end of the row. Clicking it
  // calls onChange(defaultValue). Threaded in from SchemaEditor, which
  // pulls it from the element's ElementModule.defaults dict. See the
  // `Reset button per prop` upgrade for why this lives on the control
  // instead of being computed inside ElementDetail: the control already
  // owns the row's horizontal layout, so adding a trailing 14-px slot is
  // cheaper than plumbing a wrapper component.
  defaultValue?: number;
  onChange: (v: number) => void;
};

// Parse a math-ish expression in the number input:
//   "42"        → 42
//   "+10"       → currentValue + 10
//   "-5"        → currentValue - 5   (NOTE: on a positive number)
//   "*2"        → currentValue * 2
//   "/4"        → currentValue / 4
//   "^2"        → currentValue ** 2
//   "1 + 2"     → 3
// Leading operators apply to the current value; bare numbers replace it.
// Everything else: fall back to parseFloat.
const mathEval = (input: string, current: number): number | null => {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  // Allow only digits, operators, parens, decimal, and whitespace.
  // Blocks arbitrary code — no identifiers, no function calls.
  if (!/^[-+*/^().\s\d,]+$/.test(trimmed)) {
    const fallback = Number.parseFloat(trimmed);
    return Number.isFinite(fallback) ? fallback : null;
  }
  // Leading-operator shorthand: "+10" / "*2" / "/4" / "-5" apply to current.
  const leading = /^([-+*/^])\s*(-?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*$/.exec(trimmed);
  if (leading) {
    const [, op, rhsStr] = leading;
    const rhs = Number.parseFloat(rhsStr);
    if (!Number.isFinite(rhs)) return null;
    switch (op) {
      case "+": return current + rhs;
      case "-": return current - rhs;
      case "*": return current * rhs;
      case "/": return rhs === 0 ? null : current / rhs;
      case "^": return current ** rhs;
      default: return null;
    }
  }
  // Otherwise try to eval as a full expression. Convert ^ → ** for JS.
  try {
    const expr = trimmed.replace(/\^/g, "**");
    // biome-ignore lint/security/noGlobalEval: sandboxed allowlist regex gatekeeps input; no identifiers possible.
    const result = Function(`"use strict"; return (${expr});`)();
    return typeof result === "number" && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
};

// Format the value for display. Avoids "12.0000000001" drift from math.
const formatValue = (v: number, step: number): string => {
  if (!Number.isFinite(v)) return "0";
  // Number of decimals implied by step (0.01 → 2, 0.1 → 1, 1 → 0).
  const decimals = Math.max(0, -Math.floor(Math.log10(step || 1)));
  const rounded = Number.parseFloat(v.toFixed(decimals + 2));
  return rounded.toFixed(Math.min(decimals, 4));
};

export const SharedNumericControl: React.FC<Props> = ({
  label,
  value,
  min,
  max,
  step,
  pxPerStep = 2,
  integer = false,
  defaultValue,
  onChange,
}) => {
  const [textInput, setTextInput] = useState<string>(formatValue(value, step));
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Hover flags feed subtle #1f1f1f background-highlights on the drag
  // label and slider track — the Framer/Figma idiom where the affordance
  // surfaces on pointer-enter so users discover it without reading a
  // tooltip. Passive `col-resize` alone is too easy to miss.
  const [labelHover, setLabelHover] = useState(false);
  const [sliderHover, setSliderHover] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const dragRef = useRef<{ startX: number; startValue: number } | null>(null);

  // ↺ reset affordance: show only when a schema default was threaded in
  // AND the current value differs from it (within the step resolution,
  // so micro-drift from math expressions doesn't keep the button lit
  // forever). Comparing at step-precision matches what the user sees in
  // the text input.
  const canReset =
    typeof defaultValue === "number" &&
    Number.isFinite(defaultValue) &&
    formatValue(value, step) !== formatValue(defaultValue, step);

  // Sync the text input with incoming value changes (but not while editing
  // — the user's pending "+10" typed expression shouldn't be clobbered).
  useEffect(() => {
    if (!editing) setTextInput(formatValue(value, step));
  }, [value, step, editing]);

  // Soft bounds: the slider RENDERS in [min..max], but the number input
  // and drag-scrub accept values outside. If a user types 500 in a field
  // our heuristic declared 0..400, we let it through. The slider just
  // expands to include the current value. Prevents the regression where
  // a value of 300 got clamped to 100 on first render and the user
  // couldn't type it back. Never clip user data.
  const commit = useCallback(
    (v: number) => {
      const snapped = integer ? Math.round(v) : v;
      onChange(snapped);
    },
    [integer, onChange],
  );

  const onLabelPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startValue: value };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onLabelPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    // Base speed: 1 step per pxPerStep pixels. Modifiers scale that.
    const multiplier = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
    const stepsMoved = (dx / pxPerStep) * multiplier;
    commit(dragRef.current.startValue + stepsMoved * step);
  };
  const onLabelPointerUp = (e: React.PointerEvent<HTMLSpanElement>) => {
    dragRef.current = null;
    setDragging(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const onTextCommit = () => {
    setEditing(false);
    const parsed = mathEval(textInput, value);
    if (parsed != null) commit(parsed);
    // Re-sync text to the committed (snapped/clamped) value.
    // useEffect above handles it when editing flips to false.
  };

  return (
    <div
      style={{
        display: "grid",
        // 4th column is a 14-px reset slot. Kept fixed-width so row
        // alignment stays crisp across rows where canReset is false —
        // the slot just renders an empty spacer in that case.
        gridTemplateColumns: "80px 1fr 60px 14px",
        gap: 6,
        alignItems: "center",
        padding: "3px 0",
      }}
    >
      <span
        onPointerDown={onLabelPointerDown}
        onPointerMove={dragging ? onLabelPointerMove : undefined}
        onPointerUp={onLabelPointerUp}
        onPointerCancel={onLabelPointerUp}
        onPointerEnter={() => setLabelHover(true)}
        onPointerLeave={() => setLabelHover(false)}
        title={`${label}: drag to scrub. Shift = fine (10×). Alt = coarse (10×). Range ${min}–${max}.`}
        style={{
          fontSize: 11,
          color: labelHover || dragging ? "#ddd" : "#aaa",
          cursor: dragging ? "ew-resize" : "col-resize",
          userSelect: "none",
          textTransform: "capitalize",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          // Subtle hover highlight surfaces the drag affordance. #1f1f1f
          // on the ~#111 editor surface reads as "this is interactive"
          // without screaming. Rounded so it hugs the label glyph.
          background: labelHover || dragging ? "#1f1f1f" : "transparent",
          borderRadius: 3,
          padding: "2px 5px",
          margin: "-2px -5px",
          transition: "background 80ms ease-out, color 80ms ease-out",
        }}
      >
        {label}
      </span>
      <input
        type="range"
        // Slider bounds expand to cover the current value if it's already
        // outside the heuristic range. Otherwise dragging a slider whose
        // max is below the value would jerk the value DOWN on first touch.
        min={Math.min(min, value)}
        max={Math.max(max, value)}
        step={step}
        value={value}
        onChange={(e) => commit(Number.parseFloat(e.target.value))}
        onPointerEnter={() => setSliderHover(true)}
        onPointerLeave={() => setSliderHover(false)}
        style={{
          width: "100%",
          accentColor: "#4a9",
          // Match the label's hover treatment on the track for symmetry.
          // The range element's native track can't be restyled cross-
          // browser without ::-webkit pseudos, so we apply the hint to
          // the containing row via padding on the input itself.
          background: sliderHover ? "#1f1f1f" : "transparent",
          borderRadius: 3,
          padding: "2px 0",
          transition: "background 80ms ease-out",
        }}
      />
      <input
        type="text"
        value={textInput}
        onFocus={() => { setEditing(true); setInputFocused(true); }}
        onChange={(e) => setTextInput(e.target.value)}
        onBlur={() => { setInputFocused(false); onTextCommit(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.currentTarget.blur(); }
          else if (e.key === "Escape") {
            setTextInput(formatValue(value, step));
            setEditing(false);
            e.currentTarget.blur();
          }
        }}
        title="Type a number, or +10 / -5 / *2 / /4 / ^2 to apply to current value. Enter to commit, Esc to cancel."
        style={{
          width: "100%",
          padding: "3px 5px",
          background: "#1a1a1a",
          // Focus-ring: editor accent #4a9 at 2px offset via box-shadow.
          // Real `outline-offset` was avoided because the row is already
          // dense; box-shadow ring is additive and doesn't reflow.
          border: `1px solid ${inputFocused ? "#4a9" : "#333"}`,
          boxShadow: inputFocused ? "0 0 0 2px rgba(68,170,153,0.35)" : "none",
          outline: "none",
          borderRadius: 3,
          color: "#ddd",
          fontSize: 11,
          fontFamily: "monospace",
          textAlign: "right",
          boxSizing: "border-box",
          transition: "border-color 80ms ease-out, box-shadow 80ms ease-out",
        }}
      />
      {canReset ? (
        <button
          type="button"
          onClick={() => {
            if (typeof defaultValue === "number") commit(defaultValue);
          }}
          title={`Reset to default (${formatValue(defaultValue as number, step)})`}
          style={{
            width: 14,
            height: 14,
            padding: 0,
            lineHeight: 1,
            background: "transparent",
            border: "none",
            color: "#888",
            cursor: "pointer",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onPointerEnter={(e) => { e.currentTarget.style.color = "#4a9"; }}
          onPointerLeave={(e) => { e.currentTarget.style.color = "#888"; }}
        >
          ↺
        </button>
      ) : (
        // Empty spacer preserves grid alignment when no reset is needed.
        <span aria-hidden="true" />
      )}
    </div>
  );
};

// Heuristic fallback constraints when a Zod schema has no .min/.max/.step.
// Matches the semantic audit: opacity/alpha in 0-1, size-ish in 0-400 px,
// time-ish in 0-30 sec, frame counts 0-240, etc. Conservative enough to
// be useful without being so tight that real values get clamped.
export const guessConstraints = (fieldName: string): { min: number; max: number; step: number; integer: boolean } => {
  const n = fieldName.toLowerCase();
  // 0..1 family
  if (/(^|[^a-z])(opacity|alpha|chance|probability|ratio|pct100)([^a-z]|$)/.test(n))
    return { min: 0, max: 1, step: 0.01, integer: false };
  // Percents (0..100)
  if (/(^x$|^y$|(width|height|fill|size|radius|offset)pct$)/.test(n))
    return { min: 0, max: 100, step: 0.5, integer: false };
  if (/(^width|^height|pct$)/.test(n) && n.includes("pct"))
    return { min: 0, max: 200, step: 1, integer: false };
  // Integer counts
  if (/(numberof|count|bars|samples|rings|layers|points)/.test(n))
    return { min: 1, max: 256, step: 1, integer: true };
  if (/frames?$/.test(n))
    return { min: 0, max: 240, step: 1, integer: true };
  // Font size
  if (/fontsize$/.test(n))
    return { min: 8, max: 400, step: 1, integer: false };
  if (/fontweight$/.test(n))
    return { min: 100, max: 900, step: 100, integer: true };
  // Time in seconds
  if (/(sec$|seconds$|durationsec|sigmasec|trailsec|fadesec|fadein|fadeout|decay|life)/.test(n))
    return { min: 0, max: 20, step: 0.05, integer: false };
  // Pixels (blur, stroke, line)
  if (/(blur|strokewidth|linewidth|stroke$|bordersize|gap|glow)/.test(n))
    return { min: 0, max: 50, step: 0.5, integer: false };
  // Spring physics
  if (/damping/.test(n)) return { min: 1, max: 200, step: 1, integer: false };
  if (/stiffness/.test(n)) return { min: 10, max: 1000, step: 10, integer: false };
  if (/mass/.test(n)) return { min: 0.1, max: 10, step: 0.1, integer: false };
  // Zoom / scale
  if (/(zoom|scale)/.test(n)) return { min: 0.1, max: 5, step: 0.05, integer: false };
  // Amplitude / gain
  if (/(amplitude|intensity|gain)/.test(n)) return { min: 0, max: 4, step: 0.05, integer: false };
  // Default: conservative
  return { min: 0, max: 100, step: 0.5, integer: false };
};

// Read Zod .min/.max/.step if present. Zod 4 exposes check configs on
// _def.checks. This is the internal API — wrap in try/catch so the
// entire editor doesn't crash if Zod internals shift.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const extractZodConstraints = (schema: any): { min?: number; max?: number; step?: number; integer?: boolean } => {
  try {
    const out: { min?: number; max?: number; step?: number; integer?: boolean } = {};
    const checks = schema?._def?.checks;
    if (Array.isArray(checks)) {
      for (const c of checks) {
        const kind = c?.kind ?? c?._def?.kind ?? c?.check;
        const v = c?.value ?? c?._def?.value;
        if (kind === "min" || kind === "greater_than_or_equal") out.min = v;
        if (kind === "max" || kind === "less_than_or_equal") out.max = v;
        if (kind === "multipleOf" && typeof v === "number") out.step = v;
        if (kind === "int") out.integer = true;
      }
    }
    if (schema?._def?.isInt) out.integer = true;
    return out;
  } catch {
    return {};
  }
};
