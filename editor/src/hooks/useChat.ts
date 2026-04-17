import { useCallback, useRef, useState } from "react";
import { useEditorStore } from "../store";
import { applyMutations, type MutationResult } from "../utils/applyMutations";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  mutationResult?: MutationResult;
};

const newId = () => `msg-${Math.random().toString(36).slice(2, 9)}`;

// Snapshot of the editor state we send with every /api/chat request.
// Deliberately excludes beatData — it's ~15k beats for long mixes and
// would blow past the prompt budget without adding steerable context.
const snapshotState = () => {
  const s = useEditorStore.getState();
  return {
    currentTimeSec: s.currentTimeSec,
    compositionDuration: s.compositionDuration,
    fps: s.fps,
    audioSrc: s.audioSrc,
    beatsSrc: s.beatsSrc,
    elements: s.elements,
  };
};

export const useChat = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    const userMsg: ChatMessage = { id: newId(), role: "user", content: trimmed };
    setMessages((ms) => [...ms, userMsg]);
    setPending(true);
    setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, state: snapshotState() }),
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
      }
      const payload = (await resp.json()) as {
        reply?: string;
        mutations?: unknown;
        error?: string;
      };
      if (payload.error) throw new Error(payload.error);

      const mutationResult = applyMutations(payload.mutations ?? []);
      const asstMsg: ChatMessage = {
        id: newId(),
        role: "assistant",
        content: payload.reply ?? "(no reply)",
        mutationResult,
      };
      setMessages((ms) => [...ms, asstMsg]);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const msg = (err as Error).message ?? String(err);
      setError(msg);
      setMessages((ms) => [
        ...ms,
        { id: newId(), role: "system", content: `Error: ${msg}` },
      ]);
    } finally {
      setPending(false);
      abortRef.current = null;
    }
  }, [pending]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, pending, error, send, cancel, clear };
};
