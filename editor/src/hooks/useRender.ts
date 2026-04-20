// src/hooks/useRender.ts
// Talks to the Vite sidecar POST /api/render endpoint.
// Parses the SSE stream manually — no external library needed.
import { useCallback, useRef, useState } from "react";
import { exportProject } from "../utils/projectJson";

export type RenderStatus = "idle" | "rendering" | "done" | "error" | "cancelled";

export type RenderProgress = { done: number; total: number };

export interface UseRenderReturn {
  render: (name?: string, options?: { frames?: { start: number; end: number } }) => Promise<void>;
  status: RenderStatus;
  progress: RenderProgress | null;
  error: string | null;
  outPath: string | null;
  outName: string | null;
  cancel: () => void;
}

// Minimal SSE parser — splits a raw chunk stream into named events.
// Works on streaming text, accumulating a buffer across chunks.
type SseEvent = { event: string; data: string };

function parseSseLine(buffer: string, onEvent: (e: SseEvent) => void): string {
  // SSE blocks are separated by blank lines (\n\n).
  const blocks = buffer.split("\n\n");
  // The last element may be an incomplete block — keep it.
  const incomplete = blocks.pop() ?? "";
  for (const block of blocks) {
    const lines = block.split("\n");
    let event = "message";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        event = line.slice("event: ".length).trim();
      } else if (line.startsWith("data: ")) {
        data = line.slice("data: ".length).trim();
      }
    }
    if (data) {
      onEvent({ event, data });
    }
  }
  return incomplete;
}

export const useRender = (): UseRenderReturn => {
  const [status, setStatus] = useState<RenderStatus>("idle");
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outPath, setOutPath] = useState<string | null>(null);
  const [outName, setOutName] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setStatus("cancelled");
    }
  }, []);

  const render = useCallback(async (
    name?: string,
    options?: { frames?: { start: number; end: number } },
  ) => {
    const renderName = name ?? `musicvideo-${Date.now()}`;
    const props = exportProject();

    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("rendering");
    setProgress(null);
    setError(null);
    setOutPath(null);
    setOutName(null);

    try {
      const response = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ props, name: renderName, frames: options?.frames }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Server error ${response.status}: ${text}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = ({ event, data }: SseEvent) => {
        try {
          const payload = JSON.parse(data);
          if (event === "start") {
            // outPath + outName arrive early — store them for when done fires
            if (payload.outPath) setOutPath(payload.outPath as string);
            if (payload.outName) setOutName(payload.outName as string);
          } else if (event === "progress") {
            setProgress({
              done: Number(payload.done),
              total: Number(payload.total),
            });
          } else if (event === "done") {
            if (payload.ok) {
              setOutPath(payload.outPath as string);
              if (payload.outName) setOutName(payload.outName as string);
              setStatus("done");
            } else {
              setError(`Render exited with code ${payload.code}`);
              setStatus("error");
            }
          }
          // "log" events are intentionally ignored in the UI
        } catch {
          // ignore malformed data lines
        }
      };

      // Stream loop
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer = parseSseLine(buffer + decoder.decode(value, { stream: true }), handleEvent);
      }
      // Flush any remaining buffer
      parseSseLine(buffer + decoder.decode(), handleEvent);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setStatus("cancelled");
      } else {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    } finally {
      abortRef.current = null;
    }
  }, []);

  return { render, status, progress, error, outPath, outName, cancel };
};
