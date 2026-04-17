// src/components/SchemaEditor.tsx
// Introspects a zod ZodObject and renders a form control per field.
// Handles: ZodString, ZodNumber, ZodBoolean, ZodEnum, ZodArray<ZodString>.
import type { z } from "zod";

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

const typeName = (schema: any): string => schema?._def?.typeName ?? "";

type FieldProps = {
  name: string;
  schema: any;
  value: unknown;
  onChange: (v: unknown) => void;
};

const Field: React.FC<FieldProps> = ({ name, schema, value, onChange }) => {
  const tn = typeName(schema);
  const prettyName = name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase());

  if (tn === "ZodString") {
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

  if (tn === "ZodNumber") {
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

  if (tn === "ZodBoolean") {
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

  if (tn === "ZodEnum") {
    const options: string[] = schema._def.values ?? [];
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

  if (tn === "ZodArray") {
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
    <Row label={`${prettyName} (${tn})`}>
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
  const anySchema = schema as any;
  const shape: Record<string, any> = anySchema?._def?.shape?.() ?? anySchema?.shape ?? {};
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
