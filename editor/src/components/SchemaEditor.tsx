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
import type { z } from "zod";
import { EASING_NAMES } from "@utils/easing";
import { isEasingField } from "../utils/schemaFields";

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
  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <span style={labelStyle}>{label}</span>
    {children}
  </label>
);

const isColorField = (name: string): boolean =>
  /color|stroke|fill|background/i.test(name);

// Peel optional/default/nullable off so we render the inner type.
const unwrap = (schema: any): any => {
  let s = schema;
  while (s && (s._def?.type === "optional" || s._def?.type === "default" || s._def?.type === "nullable")) {
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

const Field: React.FC<FieldProps> = ({ name, schema, value, onChange }) => {
  const inner = unwrap(schema);
  const tn = defType(inner);
  const prettyName = name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase());

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
          <select
            value={current}
            onChange={(e) => onChange(e.target.value)}
            style={fieldStyle}
          >
            {EASING_NAMES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
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
    return (
      <Row label={`${prettyName} (${num})`}>
        <input
          type="number"
          step="0.01"
          value={num}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          style={fieldStyle}
        />
      </Row>
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
      (inner.options as string[]) ??
      (inner._def?.entries ? Object.values(inner._def.entries) : []);
    return (
      <Row label={prettyName}>
        <select
          value={String(value ?? options[0] ?? "")}
          onChange={(e) => onChange(e.target.value)}
          style={fieldStyle}
        >
          {options.map((o) => (
            <option key={o} value={o}>{o}</option>
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
            onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))
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
};

export const SchemaEditor: React.FC<Props> = ({ schema, value, onChange }) => {
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
      {keys.map((k) => (
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
