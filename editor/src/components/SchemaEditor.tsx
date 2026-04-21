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
import { useState } from "react";
import type { z } from "zod";
import { isEasingField } from "../utils/schemaFields";
import { AssetPicker } from "./AssetPicker";
import { EasingCurvePreview } from "./EasingCurvePreview";
import { SharedNumericControl, extractZodConstraints, guessConstraints } from "./SharedNumericControl";

// Detect asset fields by name so we can render a "Pick" button next to the
// input. Returns the asset kind (image/video) or null if the field is not
// an asset. Matches:
//   images, imageSrc, imagePath, backgroundImage
//   videos, videoSrc, videoPath, backgroundVideo
const detectAssetKind = (name: string): "image" | "video" | null => {
  const n = name.toLowerCase();
  if (/(^|_)(image|img)s?$|image(src|path|url)$|backgroundimage$/.test(n)) return "image";
  if (/(^|_)(video|clip)s?$|video(src|path|url)$|backgroundvideo$/.test(n)) return "video";
  return null;
};

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
  onChange: (v: unknown) => void;
};

type AssetFieldProps = {
  label: string;
  kind: "image" | "video";
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
    ? `${current.length} ${kind}${current.length === 1 ? "" : "s"} selected`
    : current[0] ?? `(no ${kind} chosen)`;
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
          Pick {kind}{multi ? "s" : ""}
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

const Field: React.FC<FieldProps> = ({ name, schema, value, onChange }) => {
  const inner = unwrap(schema);
  const tn = defType(inner);
  const prettyName = name.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

  const assetKind = detectAssetKind(name);
  if (assetKind && tn === "string") {
    return (
      <AssetField label={prettyName} kind={assetKind} multi={false} value={value} onChange={onChange} />
    );
  }
  if (assetKind && tn === "array") {
    const innerElt = unwrap(inner._def?.element);
    if (defType(innerElt) === "string") {
      return (
        <AssetField label={prettyName} kind={assetKind} multi={true} value={value} onChange={onChange} />
      );
    }
  }

  if (tn === "string") {
    if (isColorField(name)) {
      return (
        <Row label={prettyName}>
          <input
            type="color"
            value={String(value ?? "#ffffff")}
            onChange={(e) => onChange(e.target.value)}
            style={{ ...fieldStyle, padding: 2, height: 28 }}
          />
        </Row>
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
    return (
      <SharedNumericControl
        label={prettyName}
        value={num}
        min={min}
        max={max}
        step={step}
        integer={integer}
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
  /**
   * Field names to skip rendering. Used by ElementDetail when a richer
   * control (e.g. SpringCurveVisualizer) has already taken ownership of
   * those props and the generic numeric input would be redundant/crude.
   */
  hiddenFields?: ReadonlySet<string>;
};

export const SchemaEditor: React.FC<Props> = ({ schema, value, onChange, hiddenFields }) => {
  // unwrap walks optional/default/nullable wrappers regardless of inner
  // type. Its signature already takes `any`, so passing a ZodType<any> needs
  // no further cast — the caller code then discriminates by _def.type.
  const anySchema = unwrap(schema);
  // Zod 4: `.shape` is a plain object on ZodObject (no function call).
  const shape: Record<string, any> = anySchema?.shape ?? {};
  const keys = Object.keys(shape);
  if (keys.length === 0) {
    return (
      <pre style={{ ...fieldStyle, margin: 0, whiteSpace: "pre-wrap" }}>
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return (
    <>
      {keys
        .filter((k) => !hiddenFields?.has(k))
        .map((k) => (
          <Field
            key={k}
            name={k}
            schema={shape[k]}
            value={value[k]}
            onChange={(v) => onChange({ [k]: v })}
          />
        ))}
    </>
  );
};
