import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store";
import {
  applyMutations,
  hasUndo,
  revertMutations,
  type MutationResult,
  type UndoSnapshot,
} from "../utils/applyMutations";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  mutationResult?: MutationResult;
  // Once undone, the button on this message is hidden and the snapshot cleared.
  undone?: boolean;
};

const newId = () => `msg-${Math.random().toString(36).slice(2, 9)}`;

// Gap C — sessionStorage persistence key. Using sessionStorage (not local)
// so the conversation clears when the tab closes but survives a dev-server
// reload mid-session.
const STORAGE_KEY = "music-video-editor-chat";

const loadMessages = (): ChatMessage[] => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive filter — only keep well-formed rows.
    return parsed.filter(
      (m): m is ChatMessage =>
        m &&
        typeof m === "object" &&
        typeof m.id === "string" &&
        typeof m.content === "string" &&
        (m.role === "user" || m.role === "assistant" || m.role === "system"),
    );
  } catch {
    return [];
  }
};

const saveMessages = (messages: ChatMessage[]): void => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // Quota errors are non-fatal — just skip persist this turn.
  }
};

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

// Gap D — cooldown state surfaced to the UI. `until` is a wall-clock ms
// timestamp at which the cooldown ends; `remainingSec` is re-derived on
// each tick so ChatPane can render a live countdown without this hook
// re-rendering the whole component tree every second.
export type Cooldown = {
  until: number;
  remainingSec: number;
};

// Parse Retry-After which can be either seconds ("30") or an HTTP-date.
// Missing / unparseable → default 60s so we don't spin the CLI immediately.
const parseRetryAfter = (header: string | null, body: string): number => {
  if (header) {
    const n = Number(header);
    if (Number.isFinite(n) && n > 0) return Math.ceil(n);
    const date = Date.parse(header);
    if (!Number.isNaN(date)) {
      const delta = Math.ceil((date - Date.now()) / 1000);
      if (delta > 0) return delta;
    }
  }
  // Fall back to looking for {"retryAfter":30} in the JSON body.
  try {
    const parsed = JSON.parse(body);
    const n = Number(parsed?.retryAfter ?? parsed?.retry_after);
    if (Number.isFinite(n) && n > 0) return Math.ceil(n);
  } catch {
    // ignore
  }
  return 60;
};

export const useChat = () => {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState<Cooldown | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Gap C — persist messages on every change.
  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  // Gap D — tick the cooldown countdown once per second until it expires.
  useEffect(() => {
    if (!cooldown) return;
    const tick = () => {
      const remaining = Math.max(
        0,
        Math.ceil((cooldown.until - Date.now()) / 1000),
      );
      if (remaining <= 0) {
        setCooldown(null);
      } else if (remaining !== cooldown.remainingSec) {
        setCooldown({ until: cooldown.until, remainingSec: remaining });
      }
    };
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const send = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed || pending) return;
      if (cooldown && cooldown.until > Date.now()) return;

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

        // Gap D — handle rate-limit responses from the sidecar.
        if (resp.status === 429) {
          const body = await resp.text().catch(() => "");
          const retrySec = parseRetryAfter(resp.headers.get("Retry-After"), body);
          const until = Date.now() + retrySec * 1000;
          setCooldown({ until, remainingSec: retrySec });
          setMessages((ms) => [
            ...ms,
            {
              id: newId(),
              role: "system",
              content: `Claude CLI rate-limited — retry in ${retrySec}s`,
            },
          ]);
          return;
        }

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
    },
    [pending, cooldown],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  // Gap B — revert the last assistant turn's mutations in one click.
  // Finds the most recent assistant message with an unexpended undo snapshot,
  // restores the pre-mutation element state, and marks that message undone.
  const undoLastTurn = useCallback(() => {
    let targetIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (
        m.role === "assistant" &&
        !m.undone &&
        m.mutationResult &&
        hasUndo(m.mutationResult.undo)
      ) {
        targetIdx = i;
        break;
      }
    }
    if (targetIdx === -1) return;
    const target = messages[targetIdx];
    if (!target.mutationResult) return;

    revertMutations(target.mutationResult.undo);
    setMessages((ms) =>
      ms.map((m, i) => (i === targetIdx ? { ...m, undone: true } : m)),
    );
  }, [messages]);

  // Index of the assistant message that would be undone next — used by the
  // UI to show the "Undo" button on only the most recent reversible turn.
  let undoableIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (
      m.role === "assistant" &&
      !m.undone &&
      m.mutationResult &&
      hasUndo(m.mutationResult.undo)
    ) {
      undoableIndex = i;
      break;
    }
  }
  const canUndo = undoableIndex !== -1;

  return {
    messages,
    pending,
    error,
    cooldown,
    canUndo,
    undoableIndex,
    send,
    cancel,
    clear,
    undoLastTurn,
  };
};

// Re-export for ChatPane so it can reference the shape without importing
// the utils module directly.
export type { UndoSnapshot };
