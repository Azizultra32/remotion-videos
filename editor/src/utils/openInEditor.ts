// Fire-and-forget helper: POST /__open-in-editor to jump to a repo-relative
// path in the user's editor. Handled by vite-plugin-sidecar.ts.

export const buildOpenInEditorUrl = (filePath: string, line?: number, column?: number): string => {
  let locator = filePath;
  if (line !== undefined) locator += `:${line}`;
  if (line !== undefined && column !== undefined) locator += `:${column}`;
  const q = new URLSearchParams({ file: locator });
  return `/__open-in-editor?${q.toString()}`;
};

export const openInEditor = async (
  filePath: string,
  line?: number,
  column?: number,
): Promise<void> => {
  try {
    await fetch(buildOpenInEditorUrl(filePath, line, column), { method: "POST" });
  } catch {
    // editor launch failures are non-fatal and non-blocking
  }
};
