// biome-ignore-all lint/suspicious/noExplicitAny: Zod schema introspection (unwrap, defType, ZodType<any>) requires the internal `any` typing

// src/components/SchemaEditor.tsx
// Introspects a Zod 4 object schema and renders a form control per field.
// Handles: string, number, boolean, enum, array<string>. Transparently
// unwraps optional/default/nullable wrappers.
//
// Zod 4 API notes (different from v3):
//   z.object({...}).shape         is a plain object (not a function)
//   schema._def.type              is a lowercase string like "string", "number"
//   schema.options                is the public array of enum values
//   wrapper._def.innerType        is the wrapped schema (optional/default/nullable)

import { EASING_NAMES } from "@utils/easing";
import type { MediaFieldDefinition } from "@compositions/elements/types";
import { useEffect, useMemo, useState } from "react";
import type { z } from "zod";
import { assetKindLabel, detectAssetKindFromFieldName, type AssetKind } from "../utils/assets";
import { isEasingField } from "../utils/schemaFields";
import { AssetPicker } from "./AssetPicker";
import { ColorField } from "./ColorField";
import { EasingCurvePreview } from "./EasingCurvePreview";
import { SharedNumericControl, extractZodConstraints, guessConstraints } from "./SharedNumericControl";
import { Vector2Field } from "./Vector2Field";

// Asset-field detection is shared in ../utils/assets so SchemaEditor and the
// picker stay aligned on image/video/GIF field names.

const fieldStyle: React.CSSProperties = {
  padding: "6px 8px",
  background: "#222",
  border: "1px solid #444",
  borderRadius: 4,
  color: "#fff",
  fontSize: 12,
  width: "100%",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = { fontSize: 11, color: "#aaa" };

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  // biome-ignore lint/a11y/noLabelWithoutControl: Row is a wrapper; control is rendered via children prop
  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <span style={labelStyle}>{label}</span>
    {children}
  </label>
);

const isColorField = (name: string): boolean => /color|stroke|fill|background/i.test(name);

// Peel optional/default/nullable off so we render the inner type.
const unwrap = (schema: any): any => {
  let s = schema;
  while (
    s &&
    (s._def?.type === "optional" || s._def?.type === "default" || s._def?.type === "nullable")
  ) {
    s = s._def.innerType;
  }
  return s;
};

const defType = (schema: any): string => schema?._def?.type ?? "";

type FieldProps = {
  name: string;
  schema: any;
  value: unknown;
  mediaFields?: readonly MediaFieldDefinition[];
  // Optional schema default, threaded into numeric controls for the ↺
  // reset affordance. Undefined for fields where the element module
  // didn't supply a default (e.g. string fields, unset props).
  defaultValue?: unknown;
  onChange: (v: unknown) => void;
};

type AssetFieldProps = {
  label: string;
  kind: AssetKind;
  multi: boolean;
  value: unknown;
  onChange: (v: unknown) => void;
};

const AssetField: React.FC<AssetFieldProps> = ({ label, kind, multi, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const current: string[] = multi
    ? Array.isArray(value) ? (value as string[]) : []
    : typeof value === "string" && value ? [value] : [];
  const summary = multi
    ? `${current.length} ${assetKindLabel(kind)}${current.length === 1 ? "" : "s"} selected`
    : current[0] ?? `(no ${assetKindLabel(kind)} chosen)`;
  return (
    <Row label={label}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <div
          style={{
            ...fieldStyle,
            flex: 1,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            cursor: "pointer",
            color: current.length > 0 ? "#fff" : "#888",
          }}
          onClick={() => setOpen(true)}
          title={multi ? current.join("\n") : current[0] ?? ""}
        >
          {summary}
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            padding: "6px 10px",
            background: "#2a4a7a",
            border: "1px solid #3a6aaa",
            color: "#fff",
            fontSize: 11,
            borderRadius: 4,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Pick {assetKindLabel(kind)}{multi ? "s" : ""}
        </button>
      </div>
      {multi && current.length > 0 && (
        <div style={{ fontSize: 10, color: "#888", marginTop: 2, maxHeight: 60, overflowY: "auto" }}>
          {current.map((p) => (
            <div key={p} style={{ fontFamily: "monospace" }}>{p}</div>
          ))}
        </div>
      )}
      {open && (
        <AssetPicker
          kind={kind}
          multi={multi}
          initial={current}
          onCommit={(paths) => {
            onChange(multi ? paths : (paths[0] ?? ""));
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      )}
    </Row>
  );
};

const Field: React.FC<FieldProps> = ({ name, schema, value, mediaFields, defaultValue, onChange }) => {
  const inner = unwrap(schema);
  const tn = defType(inner);
  const prettyName = name.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

  const declaredMediaField = mediaFields?.find((field) => field.name === name) ?? null;
  const assetKind = declaredMediaField?.kind ?? detectAssetKindFromFieldName(name);
  const multi = declaredMediaField?.multi ?? false;
  if (assetKind && tn === "string" && !multi) {
    return (
      <AssetField label={prettyName} kind={assetKind} multi={false} value={value} onChange={onChange} />
    );
  }
  if (assetKind && tn === "array" && (multi || !declaredMediaField)) {
    const innerElt = unwrap(inner._def?.element);
    if (defType(innerElt) === "string") {
      return (
        <AssetField label={prettyName} kind={assetKind} multi={true} value={value} onChange={onChange} />
      );
    }
  }

  if (tn === "string") {
    if (isColorField(name)) {
      // ColorField owns its own row layout (swatch + HEX + optional reset
      // + popover with recent-colors history). No <Row> wrapper — that
      // would double up labels.
      return (
        <ColorField
          label={prettyName}
          value={String(value ?? "#ffffff")}
          onChange={(hex) => onChange(hex)}
        />
      );
    }
    if (isEasingField(name)) {
      const current = String(value ?? "linear");
      return (
        <Row label={prettyName}>
          <select value={current} onChange={(e) => onChange(e.target.value)} style={fieldStyle}>
            {EASING_NAMES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <EasingCurvePreview name={current} />
        </Row>
      );
    }
    return (
      <Row label={prettyName}>
        <input
          type="text"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          style={fieldStyle}
        />
      </Row>
    );
  }

  if (tn === "number") {
    const num = typeof value === "number" ? value : 0;
    // Merge Zod-declared constraints with field-name heuristics. Schema
    // authors who added .min/.max/.step win; unadorned z.number() falls
    // back to sensible defaults derived from the field name (opacity →
    // 0..1, fontSize → 8..400, sigmaSec → 0..20, etc.).
    const heuristic = guessConstraints(name);
    const zod = extractZodConstraints(inner);
    const min = zod.min ?? heuristic.min;
    const max = zod.max ?? heuristic.max;
    const step = zod.step ?? heuristic.step;
    const integer = zod.integer ?? heuristic.integer;
    const dv = typeof defaultValue === "number" ? defaultValue : undefined;
    return (
      <SharedNumericControl
        label={prettyName}
        value={num}
        min={min}
        max={max}
        step={step}
        integer={integer}
        defaultValue={dv}
        onChange={onChange}
      />
    );
  }

  if (tn === "boolean") {
    return (
      <Row label={prettyName}>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      </Row>
    );
  }

  if (tn === "enum") {
    // Zod 4: `.options` is the public array of enum values; fall back to
    // deriving from `_def.entries` for exotic schemas.
    const options: string[] =
      (inner.options as string[]) ?? (inner._def?.entries ? Object.values(inner._def.entries) : []);
    // Segmented control for small enums (≤4 options) — Figma/Framer idiom
    // gives users a single-tap visible row instead of a dropdown hiding
    // the options behind a click. Dropdown still used for large sets.
    if (options.length <= 4) {
      const current = String(value ?? options[0] ?? "");
      return (
        <Row label={prettyName}>
          <div style={{ display: "flex", gap: 2 }}>
            {options.map((o) => {
              const active = o === current;
              return (
                <button
                  type="button"
                  key={o}
                  onClick={() => onChange(o)}
                  style={{
                    flex: 1,
                    padding: "4px 6px",
                    background: active ? "#2a4a7a" : "#1a1a1a",
                    border: `1px solid ${active ? "#3a6aaa" : "#333"}`,
                    borderRadius: 3,
                    color: active ? "#fff" : "#aaa",
                    fontSize: 10,
                    fontWeight: active ? 700 : 500,
                    cursor: "pointer",
                    textTransform: "capitalize",
                  }}
                >
                  {o}
                </button>
              );
            })}
          </div>
        </Row>
      );
    }
    return (
      <Row label={prettyName}>
        <select
          value={String(value ?? options[0] ?? "")}
          onChange={(e) => onChange(e.target.value)}
          style={fieldStyle}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </Row>
    );
  }

  if (tn === "array") {
    const arr = Array.isArray(value) ? value : [];
    return (
      <Row label={`${prettyName} (one per line)`}>
        <textarea
          value={arr.join("\n")}
          onChange={(e) =>
            onChange(
              e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          rows={4}
          style={{ ...fieldStyle, fontFamily: "monospace" }}
        />
      </Row>
    );
  }

  return (
    <Row label={`${prettyName} (${tn || "unknown"})`}>
      <pre style={{ ...fieldStyle, margin: 0, whiteSpace: "pre-wrap" }}>
        {JSON.stringify(value)}
      </pre>
    </Row>
  );
};

type Props = {
  schema: z.ZodType<any>;
  value: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  mediaFields?: readonly MediaFieldDefinition[];
  /**
   * Field names to skip rendering. Used by ElementDetail when a richer
   * control (e.g. SpringCurveVisualizer) has already taken ownership of
   * those props and the generic numeric input would be redundant/crude.
   */
  hiddenFields?: ReadonlySet<string>;
  /**
   * Schema defaults from the ElementModule's `.defaults` dict. Threaded
   * through to numeric controls for the per-prop ↺ reset affordance.
   */
  defaults?: Record<string, unknown>;
  /**
   * Stable key for persisting group open/closed state in localStorage,
   * typically the ElementModule.id. When omitted, sections render open
   * and nothing is persisted. Keeps each element type's collapse state
   * independent so a complex element's layout doesn't dictate a simple
   * one's.
   */
  persistKey?: string;
};

// Shared-prefix grouping. When a schema has lots of numeric knobs that
// share a prefix (outerOpacity / outerGlow / outerOffset → "outer*"),
// bucket them under a collapsible section. We only collapse when:
//   - total field count > 8 (below that, flat reads faster), AND
//   - at least 2 distinct prefixes each have ≥ 3 fields.
// Falls back to a single flat list otherwise.
//
// Prefix extraction: leading lowercase run up to the first uppercase
// letter. "outerOpacity" → "outer"; "fadeInSec" → "fade"; "x" → "x".
// Friendly section titles for common roles; unknown prefixes keep their
// capitalized raw form.
const SECTION_TITLES: Record<string, string> = {
  outer: "Outer",
  mid: "Mid",
  middle: "Middle",
  inner: "Inner",
  core: "Core",
  spring: "Spring",
  fade: "Fade",
  color: "Color",
  fill: "Fill",
  stroke: "Stroke",
  font: "Typography",
  text: "Typography",
  bg: "Background",
  background: "Background",
  shadow: "Shadow",
  blur: "Effects",
  glow: "Effects",
};

const extractPrefix = (name: string): string => {
  const m = /^([a-z]+)(?=[A-Z]|$)/.exec(name);
  return m ? m[1] : name.toLowerCase();
};

const groupFields = (keys: string[]): { title: string; keys: string[] }[] => {
  if (keys.length <= 8) return [{ title: "", keys }];
  const buckets = new Map<string, string[]>();
  for (const k of keys) {
    const p = extractPrefix(k);
    const arr = buckets.get(p) ?? [];
    arr.push(k);
    buckets.set(p, arr);
  }
  const strong: { title: string; keys: string[] }[] = [];
  const weak: string[] = [];
  for (const [prefix, group] of buckets) {
    if (group.length >= 3) {
      const title = SECTION_TITLES[prefix] ?? (prefix.charAt(0).toUpperCase() + prefix.slice(1));
      strong.push({ title, keys: group });
    } else {
      weak.push(...group);
    }
  }
  // Require ≥2 strong buckets — otherwise collapsing buys nothing.
  if (strong.length < 2) return [{ title: "", keys }];
  // Keep original field order within each section + between sections.
  const orderedStrong = strong
    .map((s) => ({ title: s.title, keys: keys.filter((k) => s.keys.includes(k)) }))
    .sort((a, b) => keys.indexOf(a.keys[0]) - keys.indexOf(b.keys[0]));
  if (weak.length > 0) {
    orderedStrong.push({ title: "Other", keys: keys.filter((k) => weak.includes(k)) });
  }
  return orderedStrong;
};

const storageKey = (persistKey: string, title: string): string =>
  `mv-editor.schemaGroups.${persistKey}.${title || "_all"}`;

// Pairs that collapse into a single Vector2Field instead of two scalar
// rows. Anchor = first-appearing key (where the Vector2 renders in the
// list); sibling = removed from the normal loop. `linkable` enables the
// lock-aspect toggle (size pairs); `showPreview` draws the 32×20
// crosshair preview (position pairs).
type PairConfig = {
  x: string;
  y: string;
  label: string;
  linkable: boolean;
  showPreview: boolean;
};
const VECTOR_PAIRS: readonly PairConfig[] = [
  // Position: independent axes, crosshair preview so 50/50 reads as "center."
  { x: "x", y: "y", label: "Position", linkable: false, showPreview: true },
  // Size: aspect-lockable, no crosshair (a size isn't a point in space).
  { x: "widthPct", y: "heightPct", label: "Size", linkable: true, showPreview: false },
];

// Given the ordered key list of a schema, compute which keys are pair
// anchors, which are siblings to skip, and what config each anchor uses.
// Pure — no React state involved — memoized by the caller via keys.join.
const detectVectorPairs = (
  keys: string[],
): { anchors: Map<string, PairConfig>; siblings: Set<string> } => {
  const anchors = new Map<string, PairConfig>();
  const siblings = new Set<string>();
  const keySet = new Set(keys);
  for (const p of VECTOR_PAIRS) {
    if (!keySet.has(p.x) || !keySet.has(p.y)) continue;
    // Respect schema declaration order — if `y` appears before `x`,
    // the Vector2 renders at y's slot.
    const ix = keys.indexOf(p.x);
    const iy = keys.indexOf(p.y);
    const first = ix < iy ? p.x : p.y;
    const second = first === p.x ? p.y : p.x;
    anchors.set(first, p);
    siblings.add(second);
  }
  return { anchors, siblings };
};

const CollapsibleSection: React.FC<{
  title: string;
  persistKey: string;
  children: React.ReactNode;
}> = ({ title, persistKey, children }) => {
  const key = storageKey(persistKey, title);
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
      return raw === null ? true : raw === "1";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      if (typeof window !== "undefined") window.localStorage.setItem(key, open ? "1" : "0");
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [open, key]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 6px",
          background: "transparent",
          border: "none",
          borderBottom: "1px solid #2a2a2a",
          color: "#bbb",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ display: "inline-block", width: 10, color: "#666" }}>
          {open ? "▾" : "▸"}
        </span>
        {title}
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{children}</div>
      )}
    </div>
  );
};

export const SchemaEditor: React.FC<Props> = ({
  schema,
  value,
  onChange,
  mediaFields,
  hiddenFields,
  defaults,
  persistKey,
}) => {
  // unwrap walks optional/default/nullable wrappers regardless of inner
  // type. Its signature already takes `any`, so passing a ZodType<any> needs
  // no further cast — the caller code then discriminates by _def.type.
  const anySchema = unwrap(schema);
  // Zod 4: `.shape` is a plain object on ZodObject (no function call).
  const shape: Record<string, any> = anySchema?.shape ?? {};
  const allKeys = Object.keys(shape);

  // Detect x/y and widthPct/heightPct pairs on THIS schema. Anchor
  // renders as a Vector2Field; sibling is removed from the visible set
  // so the normal loop/grouping doesn't double-render it.
  const allKeysSig = allKeys.join("|");
  const pairMap = useMemo(
    () => detectVectorPairs(allKeys),
    // biome-ignore lint/correctness/useExhaustiveDependencies: allKeysSig
    // is the stringified identity of allKeys; the only real dependency.
    [allKeysSig],
  );

  const visibleKeys = useMemo(
    () =>
      allKeys.filter(
        (k) => !hiddenFields?.has(k) && !pairMap.siblings.has(k),
      ),
    [allKeys, hiddenFields, pairMap],
  );
  const groups = useMemo(() => groupFields(visibleKeys), [visibleKeys]);

  if (allKeys.length === 0) {
    return (
      <pre style={{ ...fieldStyle, margin: 0, whiteSpace: "pre-wrap" }}>
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  const renderField = (k: string) => {
    const pair = pairMap.anchors.get(k);
    if (pair) {
      // Resolve constraints for both axes the same way Field does for
      // scalar numbers: Zod-declared .min/.max/.step wins; then field-
      // name heuristics. Extra unwrap because shape[pair.x] may be
      // wrapped (optional/default) — e.g. z.number().min(1).max(200).default(100).
      const xSchema = unwrap(shape[pair.x]);
      const ySchema = unwrap(shape[pair.y]);
      const xH = guessConstraints(pair.x);
      const yH = guessConstraints(pair.y);
      const xZ = extractZodConstraints(xSchema);
      const yZ = extractZodConstraints(ySchema);
      const xVal = typeof value[pair.x] === "number" ? (value[pair.x] as number) : 0;
      const yVal = typeof value[pair.y] === "number" ? (value[pair.y] as number) : 0;
      return (
        <Vector2Field
          key={`__pair_${pair.x}_${pair.y}`}
          label={pair.label}
          xValue={xVal}
          yValue={yVal}
          xMin={xZ.min ?? xH.min}
          xMax={xZ.max ?? xH.max}
          xStep={xZ.step ?? xH.step}
          yMin={yZ.min ?? yH.min}
          yMax={yZ.max ?? yH.max}
          yStep={yZ.step ?? yH.step}
          linkable={pair.linkable}
          showPreview={pair.showPreview}
          onChange={(x, y) => onChange({ [pair.x]: x, [pair.y]: y })}
        />
      );
    }
    return (
      <Field
        key={k}
        name={k}
        schema={shape[k]}
        value={value[k]}
        mediaFields={mediaFields}
        defaultValue={defaults?.[k]}
        onChange={(v) => onChange({ [k]: v })}
      />
    );
  };

  // Flat list: preserves the pre-upgrade look for elements with ≤8
  // fields or schemas where no strong prefix cluster emerged.
  if (groups.length === 1 && groups[0].title === "") {
    return <>{groups[0].keys.map(renderField)}</>;
  }

  return (
    <>
      {groups.map((g) =>
        g.title === "" ? (
          <div key="__flat" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {g.keys.map(renderField)}
          </div>
        ) : (
          <CollapsibleSection
            key={g.title}
            title={g.title}
            persistKey={persistKey ?? "_default"}
          >
            {g.keys.map(renderField)}
          </CollapsibleSection>
        ),
      )}
    </>
  );
};
