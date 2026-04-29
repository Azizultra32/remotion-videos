// src/components/ElementDetail.tsx

import { getElementModule, getElementSourcePath } from "@compositions/elements/registry";
import { useEditorStore } from "../store";
import { stemFromAudioSrc } from "../utils/url";
import { SchemaEditor } from "./SchemaEditor";
import { FadeEnvelopeVisualizer } from "./FadeEnvelopeVisualizer";
import { RawPropsEditor } from "./RawPropsEditor";
import { SpringCurveVisualizer } from "./SpringCurveVisualizer";

const fieldStyle: React.CSSProperties = {
  padding: "6px 8px",
  background: "var(--surface-3)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-primary)",
  fontSize: 12,
  fontFamily: "var(--font-ui)",
  transition: "border-color 120ms ease",
};

const labelStyle: React.CSSProperties = { fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 };

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  // biome-ignore lint/a11y/noLabelWithoutControl: Field is a wrapper; control is rendered via children prop
  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <span style={labelStyle}>{label}</span>
    {children}
  </label>
);

const buildTimingEditorHash = (damping: number, stiffness: number): string => {
  const cfg = {
    components: [
      {
        id: "timing-1",
        mixingMode: "additive",
        config: {
          type: "spring",
          springConfig: { damping, mass: 1, stiffness, overshootClamping: false },
          durationInFrames: null,
          delay: 0,
          reverse: false,
        },
      },
    ],
    selectedAnimation: "Scale",
  };
  return `#config=${btoa(JSON.stringify(cfg))}`;
};

// Fields owned by SpringCurveVisualizer — hidden from SchemaEditor so
// users aren't editing them in two places (the visualizer IS the control).
const SPRING_FIELDS: ReadonlySet<string> = new Set([
  "damping",
  "mass",
  "stiffness",
  "overshootClamping",
]);

// Fields owned by FadeEnvelopeVisualizer — hidden from SchemaEditor
// so the trapezoidal envelope is the sole control (not duplicated
// under the generic numeric editor below). IMPORTANT: the visualizer
// only renders when BOTH fadeInSec AND fadeOutSec exist on the
// element; if only one is present, we must NOT hide it, or the user
// loses access to it entirely. The gating decision is made at render
// time below via hasFadeEnvelope; this constant is now just a
// reference list of the paired field names.
const FADE_FIELD_NAMES: ReadonlySet<string> = new Set([
  "fadeInSec",
  "fadeOutSec",
]);

export const ElementDetail = () => {
  const { selectedElementId, elements, updateElement, removeElement, beatData, snapMode, events } =
    useEditorStore();
  const setElementLocked = useEditorStore((s) => s.setElementLocked);
  const element = elements.find((e) => e.id === selectedElementId);
  const isLocked = !!element?.locked;
  const origin = element?.origin ?? "user";

  if (!element) {
    return (
      <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-ui)" }}>
        No element selected. Click an element on the timeline to edit.
      </div>
    );
  }

  const mod = getElementModule(element.type);

  const snapStart = () => {
    if (!beatData) return;
    const beats = beatData.beats ?? [];
    if (beats.length === 0) return;
    let best = beats[0];
    let bestDist = Math.abs(beats[0] - element.startSec);
    for (const b of beats) {
      const d = Math.abs(b - element.startSec);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    updateElement(element.id, { startSec: best });
  };

  const hasSpringProps =
    typeof element.props.damping === "number" && typeof element.props.stiffness === "number";
  const hasFadeEnvelope =
    typeof element.props.fadeInSec === "number" &&
    typeof element.props.fadeOutSec === "number";
  const openTimingEditor = () => {
    const d = Number(element.props.damping);
    const s = Number(element.props.stiffness);
    const url = `https://www.remotion.dev/timing-editor${buildTimingEditorHash(d, s)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const fps = useEditorStore.getState().fps;

  return (
    // Density pass: padding 16→10, row gap 12→8. Matches the tighter
    // feel of col-1 palette. Column is its own overflow-y scroller
    // (owned by App.tsx's col-2 div) so we don't set overflow here.
    <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      {/*
        Sticky header. When the prop list is long enough to scroll, the
        user loses track of which element they're editing. Pinning the
        label + type chip to the top of the column (via sticky, not
        fixed — scoped to the scrollable parent) keeps that context
        visible without stealing real estate when the list is short.
        Margin negatives pull it flush to col-2's 10-px pad so the
        backdrop extends edge-to-edge behind the title text.
      */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          background: "var(--surface-1)",
          margin: "-10px -10px 0 -10px",
          padding: "10px 10px 8px 10px",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
          <h3
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-primary)",
              fontFamily: "var(--font-ui)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
              flex: 1,
            }}
            title={`${element.label} — ${mod ? mod.id : `unknown: ${element.type}`}`}
          >
            {element.label}{" "}
            <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 10 }}>
              ({mod ? mod.id : `unknown: ${element.type}`})
            </span>
          </h3>
          <button
            type="button"
            onClick={() => removeElement(element.id)}
            className="editor-btn editor-btn--danger"
            style={{ flexShrink: 0, fontSize: 10 }}
          >
            Delete
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span
            className="editor-pill"
            style={{
              fontSize: 9,
              background: "var(--surface-3)",
              border: "1px solid var(--border-default)",
              color: "var(--text-secondary)",
              letterSpacing: "0.08em",
            }}
          >
            ORIGIN: {origin.toUpperCase()}
          </span>
          <button
            type="button"
            onClick={() => setElementLocked(element.id, !isLocked)}
            className="editor-btn"
            style={{
              fontSize: 10,
              padding: "2px 8px",
              background: isLocked ? "var(--accent-muted)" : "var(--surface-3)",
              color: isLocked ? "var(--accent-hover)" : "var(--text-secondary)",
              borderColor: isLocked ? "rgba(59,130,246,0.3)" : "var(--border-default)",
            }}
            title="Locked elements resist deletion and snap-to-beat when moved"
          >
            {isLocked ? "UNLOCK" : "LOCK"}
          </button>
        </div>
      </div>

      {!mod && (
        <div
          style={{
            padding: 8,
            background: "#3a1a1a",
            color: "#faa",
            fontSize: 11,
            borderRadius: 4,
          }}
        >
          No renderer registered for type <code>{element.type}</code>. This element will not appear
          in the preview. Delete it or change the type.
        </div>
      )}

      <Field label="Label">
        <input
          type="text"
          value={element.label}
          onChange={(e) => updateElement(element.id, { label: e.target.value })}
          style={fieldStyle}
        />
      </Field>

      <div style={{ display: "flex", gap: 8 }}>
        <Field label="Start Time (sec)">
          <input
            type="number"
            step="0.1"
            min={0}
            value={element.startSec}
            onChange={(e) =>
              updateElement(element.id, { startSec: parseFloat(e.target.value) || 0 })
            }
            style={fieldStyle}
          />
        </Field>
        {beatData && snapMode !== "off" && (
          <button
            type="button"
            onClick={snapStart}
            title="Snap start time to nearest detected beat"
            style={{
              alignSelf: "flex-end",
              padding: "6px 8px",
              background: "#1a3a1a",
              border: "1px solid #386",
              borderRadius: 4,
              color: "#afa",
              fontSize: 10,
              cursor: "pointer",
              height: 30,
            }}
          >
            Snap
          </button>
        )}
      </div>

      <Field label="Anchor start to event">
        <select
          value={element.startEvent ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            updateElement(element.id, {
              startEvent: v === "" ? undefined : v,
            });
          }}
          style={fieldStyle}
          title={
            element.startEvent
              ? `Render-time start tracks event "${element.startEvent}". Unset to use Start Time (sec) directly.`
              : "Pick a named event to anchor this element's start to. When the event moves, so does the element."
          }
        >
          <option value="">— none (use start time above)</option>
          {events.map((ev) => (
            <option key={ev.name} value={ev.name}>
              {ev.name} @ {ev.timeSec.toFixed(2)}s
            </option>
          ))}
          {element.startEvent && !events.some((ev) => ev.name === element.startEvent) && (
            <option value={element.startEvent}>⚠ {element.startEvent} (event missing)</option>
          )}
        </select>
      </Field>

      <Field label="Duration (sec)">
        <input
          type="number"
          step="0.1"
          min={0.05}
          value={element.durationSec}
          onChange={(e) =>
            updateElement(element.id, { durationSec: parseFloat(e.target.value) || 0.05 })
          }
          style={fieldStyle}
        />
      </Field>

      <Field label="Track Index">
        <input
          type="number"
          step="1"
          min={0}
          max={20}
          value={element.trackIndex}
          onChange={(e) =>
            updateElement(element.id, { trackIndex: parseInt(e.target.value, 10) || 0 })
          }
          style={fieldStyle}
        />
      </Field>

      <div style={{ height: 1, background: "var(--border-subtle)", margin: "4px 0" }} />

      {hasSpringProps && (
        <SpringCurveVisualizer
          damping={Number(element.props.damping) || 10}
          mass={typeof element.props.mass === "number" ? element.props.mass : 1}
          stiffness={Number(element.props.stiffness) || 100}
          overshootClamping={!!element.props.overshootClamping}
          fps={fps}
          onChange={(patch) =>
            updateElement(element.id, { props: { ...element.props, ...patch } })
          }
          onOpenFullEditor={openTimingEditor}
        />
      )}

      {hasFadeEnvelope && (
        <FadeEnvelopeVisualizer
          durationSec={element.durationSec}
          fadeInSec={Number(element.props.fadeInSec) || 0}
          fadeOutSec={Number(element.props.fadeOutSec) || 0}
          onChange={(patch) =>
            updateElement(element.id, { props: { ...element.props, ...patch } })
          }
        />
      )}

      {mod &&
        (() => {
          const hidden = new Set<string>();
          if (hasSpringProps) for (const f of SPRING_FIELDS) hidden.add(f);
          // Only hide fade fields when BOTH are present (visualizer renders).
          // If an element has only fadeInSec OR only fadeOutSec, fall
          // through to the generic numeric editor so the field stays
          // editable — previously both were hidden unconditionally and
          // a single-fade element lost its control entirely.
          if (hasFadeEnvelope) for (const f of FADE_FIELD_NAMES) hidden.add(f);
          return (
            <SchemaEditor
              schema={mod.schema}
              value={element.props}
              // Thread defaults so per-prop ↺ reset can light up when the
              // current value differs from the module's canonical default.
              defaults={mod.defaults as Record<string, unknown>}
              mediaFields={mod.mediaFields}
              // Scope group collapse state per element type so each
              // element type's ergonomic layout is independent.
              persistKey={mod.id}
              onChange={(patch) =>
                updateElement(element.id, { props: { ...element.props, ...patch } })
              }
              hiddenFields={hidden.size > 0 ? hidden : undefined}
            />
          );
        })()}

      {/*
        Programmatic escape hatch. Shows the element's full props as JSON,
        split into schema-managed (read-only mirror) and extra (editable).
        Users can set props the widget panel doesn't expose by typing them
        here — the Renderer receives them via element.props. For per-project
        custom elements, an "Edit source" button opens the .tsx so the user
        can promote an extra prop to a schema-backed widget.
      */}
      {mod && (
        <RawPropsEditor
          value={element.props as Record<string, unknown>}
          schemaKeys={new Set(Object.keys(((mod.schema as unknown as { shape: Record<string, unknown> }).shape) ?? {}))}
          elementType={element.type}
          sourcePath={(() => {
            // Engine elements have known paths in the registry.
            const enginePath = getElementSourcePath(element.type);
            if (enginePath) return enginePath;
            // Per-project custom elements live at projects/<stem>/custom-elements/<Name>.tsx.
            // We can't know the exact filename from the id alone, but id is
            // conventionally `custom.<stem>.<name>` and file-stems often
            // track the label. Best-effort guess.
            if (element.type.startsWith("custom.")) {
              const state = useEditorStore.getState();
              const stem = stemFromAudioSrc(state.audioSrc);
              if (stem) {
                // Label → PascalCase .tsx name (scaffold convention)
                const name = (mod.label || element.type.split(".").pop() || "Element")
                  .replace(/[^a-zA-Z0-9]+/g, " ")
                  .replace(/\s+/g, " ")
                  .trim()
                  .split(" ")
                  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                  .join("");
                return `projects/${stem}/custom-elements/${name}.tsx`;
              }
            }
            return null;
          })()}
          onChange={(next) => updateElement(element.id, { props: next })}
        />
      )}
    </div>
  );
};
