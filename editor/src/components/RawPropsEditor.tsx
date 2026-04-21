// editor/src/components/RawPropsEditor.tsx
//
// The "programmatic escape hatch." Shows the element's full props as raw
// editable JSON, with a clear split:
//
//   SCHEMA PROPS      — fields declared in the element's Zod schema.
//                       Widgets above are editing THESE; the JSON here
//                       is read-only for them (a mirror).
//   EXTRA PROPS       — any keys present on element.props but NOT in the
//                       schema. Accepted and persisted; passed straight
//                       to the Renderer. This is how you set experimental
//                       props that aren't widget-surfaced yet.
//
// Why this exists: users want to set props that Remotion / the renderer
// supports but the widget panel doesn't cover yet. Rather than wait for
// a schema update, they can type `{ "glowRotation": 45 }` into the
// extra-props box and the Renderer will see it via element.props —
// provided the Renderer destructures it.
//
// The "Edit source" button (per-project custom elements only) opens
// the .tsx file in your editor so you can add the prop properly:
//   1. extend the Zod schema
//   2. add to defaults
//   3. destructure + use in the Renderer
// Next reload, the widget shows up automatically.

import { useEffect, useRef, useState } from "react";
import { openInEditor } from "../utils/openInEditor";

type Props = {
  // The full current props object for this element.
  value: Record<string, unknown>;
  // The set of keys declared in the Zod schema. Keys NOT in this set are
  // rendered as "extra" and editable here; keys IN this set are rendered
  // read-only (the widget panel owns them).
  schemaKeys: Set<string>;
  // Element type id — used to resolve the source path for "Edit source".
  elementType: string;
  // Optional source path override (for per-project custom elements, we
  // can point at projects/<stem>/custom-elements/<Name>.tsx).
  sourcePath?: string | null;
  onChange: (nextProps: Record<string, unknown>) => void;
};

const prettyJson = (v: unknown): string => {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return "";
  }
};

export const RawPropsEditor: React.FC<Props> = ({
  value,
  schemaKeys,
  elementType,
  sourcePath,
  onChange,
}) => {
  const [open, setOpen] = useState(false);
  const [extraText, setExtraText] = useState("");
  const [extraError, setExtraError] = useState<string | null>(null);
  const dirtyRef = useRef(false);

  // Split props into schema-managed vs extra.
  const schemaProps: Record<string, unknown> = {};
  const extraProps: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (schemaKeys.has(k)) schemaProps[k] = v;
    else extraProps[k] = v;
  }

  // Sync textarea from props when the element/props change AND the user
  // isn't mid-edit. Otherwise their pending keystrokes would be clobbered.
  useEffect(() => {
    if (!dirtyRef.current) {
      setExtraText(Object.keys(extraProps).length > 0 ? prettyJson(extraProps) : "");
      setExtraError(null);
    }
    // Recompute when the element identity or extra-key set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementType, Object.keys(extraProps).sort().join(",")]);

  const commitExtra = () => {
    dirtyRef.current = false;
    const trimmed = extraText.trim();
    if (!trimmed) {
      // Empty extra box = remove all extra props, keep schema-managed.
      setExtraError(null);
      onChange(schemaProps);
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setExtraError("Must be a JSON object `{ ... }`");
        return;
      }
      // Disallow collisions with schema-managed keys — the widgets own those.
      const collisions = Object.keys(parsed).filter((k) => schemaKeys.has(k));
      if (collisions.length > 0) {
        setExtraError(`These keys are owned by widgets above; edit them there: ${collisions.join(", ")}`);
        return;
      }
      setExtraError(null);
      onChange({ ...schemaProps, ...parsed });
    } catch (e) {
      setExtraError(`Invalid JSON — ${(e as Error).message}`);
    }
  };

  const header = (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      style={{
        all: "unset",
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 8px",
        background: "#1a1205",
        border: "1px solid #4a3510",
        borderRadius: 4,
        color: "#d4a017",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        cursor: "pointer",
        width: "calc(100% - 16px)",
      }}
      title={open ? "Hide raw props" : "Show raw props + programmatic escape hatch"}
    >
      <span>{open ? "▼" : "▶"}</span>
      <span>ADVANCED · RAW PROPS</span>
      <span style={{ flex: 1 }} />
      <span style={{ color: "#8a7030", fontSize: 9 }}>
        {Object.keys(extraProps).length > 0 ? `${Object.keys(extraProps).length} extra` : "JSON"}
      </span>
    </button>
  );

  if (!open) return header;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {header}

      {/* Schema-managed props (read-only mirror) */}
      <div style={{ fontSize: 9, color: "#666", letterSpacing: "0.06em", marginTop: 4 }}>
        SCHEMA PROPS (edit with widgets above)
      </div>
      <pre
        style={{
          margin: 0,
          padding: 6,
          background: "#0c0c0c",
          border: "1px solid #222",
          borderRadius: 3,
          color: "#999",
          fontSize: 10,
          fontFamily: "monospace",
          maxHeight: 140,
          overflow: "auto",
          whiteSpace: "pre-wrap",
        }}
      >
        {prettyJson(schemaProps)}
      </pre>

      {/* Extra props (editable) */}
      <div style={{ fontSize: 9, color: "#666", letterSpacing: "0.06em", marginTop: 2 }}>
        EXTRA PROPS (keys not in schema — pass straight to Renderer)
      </div>
      <textarea
        value={extraText}
        onChange={(e) => {
          dirtyRef.current = true;
          setExtraText(e.target.value);
          setExtraError(null);
        }}
        onBlur={commitExtra}
        placeholder='{\n  "glowRotation": 45,\n  "experimentalPulse": true\n}'
        spellCheck={false}
        rows={5}
        style={{
          padding: 6,
          background: "#0c0c0c",
          border: `1px solid ${extraError ? "#833" : "#222"}`,
          borderRadius: 3,
          color: "#ddd",
          fontSize: 11,
          fontFamily: "monospace",
          resize: "vertical",
        }}
      />
      {extraError && (
        <div style={{ fontSize: 10, color: "#f88", fontFamily: "monospace" }}>{extraError}</div>
      )}

      {/* Guidance + edit-source affordance */}
      <div style={{ fontSize: 9, color: "#777", lineHeight: 1.5, padding: "4px 0" }}>
        To turn an extra prop into a proper widget: edit the element's source
        file, add the prop to its Zod schema with <code>.min().max().step()</code>,
        add a default, and wire it into the Renderer. Reload the editor and
        it'll appear as a slider.
      </div>
      {sourcePath && (
        <button
          type="button"
          onClick={() => void openInEditor(sourcePath)}
          style={{
            alignSelf: "flex-start",
            padding: "4px 10px",
            background: "#2a4a7a",
            border: "1px solid #3a6aaa",
            borderRadius: 3,
            color: "#fff",
            fontSize: 10,
            cursor: "pointer",
            fontFamily: "monospace",
          }}
          title={`Open ${sourcePath} in your editor to add schema-backed props`}
        >
          ✎ Edit source ({sourcePath.split("/").slice(-2).join("/")})
        </button>
      )}
    </div>
  );
};
