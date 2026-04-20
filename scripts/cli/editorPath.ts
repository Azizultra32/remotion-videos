// Helpers for the /__open-in-editor endpoint in vite-plugin-sidecar.ts.
// Kept pure + node-only so they can be unit-tested under editor's vitest.

import path from "node:path";

export type ParsedFileArg = {
  filePath: string;
  line: number | undefined;
  column: number | undefined;
};

const POSITIVE_INT = /^\d+$/;

export const parseFileArg = (raw: string | undefined): ParsedFileArg | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  const filePath = parts[0];
  if (!filePath) return null;
  const line = parts[1] && POSITIVE_INT.test(parts[1]) ? Number(parts[1]) : undefined;
  const column = parts[2] && POSITIVE_INT.test(parts[2]) ? Number(parts[2]) : undefined;
  return { filePath, line, column };
};

export const sanitizeEditorPath = (raw: string | undefined, repoRoot: string): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const absolute = path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : path.normalize(path.join(repoRoot, trimmed));

  const normalizedRoot = path.normalize(repoRoot);
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;

  if (absolute !== normalizedRoot && !absolute.startsWith(rootWithSep)) {
    return null;
  }

  return absolute;
};
