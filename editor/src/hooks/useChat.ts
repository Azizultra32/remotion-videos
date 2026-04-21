import { useCallback, useEffect, useRef, useState } from "react";
import { stemFromAudioSrc } from "../utils/url";
import { useEditorStore } from "../store";
import {
  applyMutations,
  hasUndo,
  type MutationResult,
  revertMutations,
  type UndoSnapshot,
} from "../utils/applyMutations";

export type ToolCall = {
  id: string;
  name: string;
  input: unknown;
  result?: string;
  isError?: boolean;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  mutationResult?: MutationResult;
  // Once undone, the button on this message is hidden and the snapshot cleared.
  undone?: boolean;
  // Tool calls made during this assistant turn. Populated incrementally from
  // the /api/chat/stream transport; each item is a Read / Bash / Grep / etc.
  // invocation with its input args and (eventually) its result.
  toolCalls?: ToolCall[];
  // True while this message is still being streamed in. Used by the UI to
  // show a subtle pulsing indicator rather than treating it as complete.
  streaming?: boolean;
};

const newId = () => `msg-${Math.random().toString(36).slice(2, 9)}`;

// localStorage persistence: chat history survives tab close + dev-server
// reload. User clears explicitly via the Clear button in ChatPane. Per-
// session-only state (streaming flag, tool-call partial results) is not
// persisted — only finalized turn content.
//
// PER-PROJECT: key is scoped to the active stem (track). Switching tracks
// gives you that track's chat history — previously the key was global
// and every project saw the same conversation, which meant asking about
// "this track" referenced the wrong song. Migration: when we encounter
// the old unscoped key at boot we rename it to the currently-active
// stem's key so nothing is lost.
const STORAGE_KEY_PREFIX = "music-video-editor-chat";
const LEGACY_KEY = "music-video-editor-chat";

const storageKeyForStem = (stem: string | null): string =>
  stem ? `${STORAGE_KEY_PREFIX}:${stem}` : `${STORAGE_KEY_PREFIX}:_unassigned`;

const loadMessages = (stem: string | null): ChatMessage[] => {
  try {
    const key = storageKeyForStem(stem);
    // Migrate legacy global history to the current stem on first load.
    if (stem && !localStorage.getItem(key)) {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        localStorage.setItem(key, legacy);
        localStorage.removeItem(LEGACY_KEY);
      }
    }
    const raw = localStorage.getItem(key);
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

const saveMessages = (stem: string | null, messages: ChatMessage[]): void => {
  try {
    localStorage.setItem(storageKeyForStem(stem), JSON.stringify(messages));
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
  // Subscribe to audioSrc → stem so when the user switches tracks the
  // chat state rehydrates from THAT track's stored history.
  const audioSrc = useEditorStore((s) => s.audioSrc);
  const stem = stemFromAudioSrc(audioSrc);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(stem));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState<Cooldown | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Debounced save-to-disk timer. localStorage writes are synchronous
  // every change; disk POST is debounced at 800 ms so a flurry of
  // streaming message updates coalesces into one HTTP request.
  const diskSaveTimerRef = useRef<number | null>(null);
  // Guard: don't overwrite disk with a load that came FROM disk.
  const hydratedFromDiskRef = useRef<string | null>(null);

  // Rehydrate when the stem changes. Two-phase: (1) instantly render
  // from localStorage (fast, same browser), (2) fetch chat.json from
  // disk and replace if it's newer (cross-browser / cross-machine).
  useEffect(() => {
    // Phase 1: localStorage instant.
    const cached = loadMessages(stem);
    setMessages(cached);
    hydratedFromDiskRef.current = null;

    // Phase 2: async disk fetch, only if we have a stem.
    if (!stem) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/chat-history/${encodeURIComponent(stem)}`);
        if (!r.ok) return;
        const data = await r.json();
        const diskMessages: unknown = data?.messages;
        if (!Array.isArray(diskMessages)) return;
        const valid = (diskMessages as unknown[]).filter(
          (m): m is ChatMessage =>
            !!m &&
            typeof m === "object" &&
            typeof (m as { id?: unknown }).id === "string" &&
            typeof (m as { content?: unknown }).content === "string" &&
            ((m as { role?: unknown }).role === "user" ||
              (m as { role?: unknown }).role === "assistant" ||
              (m as { role?: unknown }).role === "system"),
        );
        if (cancelled) return;
        // Adopt disk copy if it has strictly MORE messages OR if we had
        // nothing cached. If localStorage is ahead (user typed offline
        // in another tab, say), keep the cache — next save pushes it
        // back to disk. Conservative: prefer "more is more."
        if (valid.length > cached.length) {
          setMessages(valid);
          hydratedFromDiskRef.current = JSON.stringify(valid);
        }
      } catch {
        /* offline or sidecar down — cached localStorage is enough */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stem]);

  // Dual-target persist on every message change:
  //   1. localStorage immediately — instant same-browser reload
  //   2. disk via POST /api/chat-history/save, debounced 800 ms —
  //      survives cross-browser / cross-machine
  useEffect(() => {
    saveMessages(stem, messages);
    if (!stem) return;
    if (diskSaveTimerRef.current) window.clearTimeout(diskSaveTimerRef.current);
    diskSaveTimerRef.current = window.setTimeout(() => {
      // Skip the write if we just hydrated from disk and nothing changed.
      const json = JSON.stringify(messages);
      if (hydratedFromDiskRef.current === json) return;
      void fetch("/api/chat-history/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stem, messages }),
      }).catch(() => {
        /* sidecar offline is fine; localStorage is the hot cache */
      });
    }, 800);
    return () => {
      if (diskSaveTimerRef.current) window.clearTimeout(diskSaveTimerRef.current);
    };
  }, [stem, messages]);

  // Gap D — tick the cooldown countdown once per second until it expires.
  useEffect(() => {
    if (!cooldown) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((cooldown.until - Date.now()) / 1000));
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

      // Assistant message placeholder we\'ll mutate as the stream lands.
      const asstId = newId();
      setMessages((ms) => [
        ...ms,
        { id: asstId, role: "assistant", content: "", streaming: true, toolCalls: [] },
      ]);

      // Final payload accumulators — applied to the placeholder on `done`.
      let finalReply: string | null = null;
      let finalMutations: unknown[] = [];
      let rateLimited = false;

      const patchAsst = (fn: (m: ChatMessage) => ChatMessage): void => {
        setMessages((ms) => ms.map((m) => (m.id === asstId ? fn(m) : m)));
      };

      try {
        const resp = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            state: snapshotState(),
            // Last 8 turns of conversation history (trimmed). Lets Claude
            // resolve "that element" / "make it bigger" against prior turns
            // without exceeding the prompt budget. Role-tagged; tool calls
            // + mutations excluded (the reply summary is sufficient).
            history: messages
              .filter((m) => m.role === "user" || m.role === "assistant")
              .slice(-8)
              .map((m) => ({ role: m.role, content: m.content.slice(0, 600) })),
          }),
          signal: ctrl.signal,
        });

        // Rate-limit surfaces from /api/chat/stream as a 429 too.
        if (resp.status === 429) {
          const body = await resp.text().catch(() => "");
          const retrySec = parseRetryAfter(resp.headers.get("Retry-After"), body);
          const until = Date.now() + retrySec * 1000;
          setCooldown({ until, remainingSec: retrySec });
          patchAsst((m) => ({
            ...m,
            content: `Rate-limited — retry in ${retrySec}s`,
            streaming: false,
          }));
          return;
        }

        if (!resp.ok || !resp.body) {
          const body = await resp.text().catch(() => "");
          throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
        }

        // Read the line-delimited JSON stream from the sidecar.
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const handleEvent = (ev: Record<string, unknown>) => {
          const t = ev.type;
          if (t === "text" && typeof ev.delta === "string") {
            const delta = ev.delta;
            patchAsst((m) => ({ ...m, content: m.content + delta }));
          } else if (t === "tool_use") {
            const call: ToolCall = {
              id: typeof ev.id === "string" ? ev.id : "",
              name: typeof ev.name === "string" ? ev.name : "unknown",
              input: ev.input ?? {},
            };
            patchAsst((m) => ({ ...m, toolCalls: [...(m.toolCalls ?? []), call] }));
          } else if (t === "tool_result") {
            const tid = typeof ev.tool_use_id === "string" ? ev.tool_use_id : "";
            const content = typeof ev.content === "string" ? ev.content : "";
            const isError = !!ev.is_error;
            patchAsst((m) => ({
              ...m,
              toolCalls: (m.toolCalls ?? []).map((tc) =>
                tc.id === tid ? { ...tc, result: content, isError } : tc,
              ),
            }));
          } else if (t === "done") {
            finalReply = typeof ev.reply === "string" ? ev.reply : null;
            finalMutations = Array.isArray(ev.mutations) ? (ev.mutations as unknown[]) : [];
          } else if (t === "error") {
            const errMsg = typeof ev.error === "string" ? ev.error : "claude-cli-failed";
            if (errMsg === "claude-cli-rate-limited") {
              rateLimited = true;
            }
            throw new Error(errMsg);
          }
        };

        // Drain the body stream.
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          while (true) {
            const idx = buf.indexOf("\n");
            if (idx === -1) break;
            const line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (!line.trim()) continue;
            try {
              handleEvent(JSON.parse(line));
            } catch {
              /* malformed line, skip */
            }
          }
        }
        // Flush trailing partial (rare).
        if (buf.trim()) {
          try {
            handleEvent(JSON.parse(buf));
          } catch {
            /* ignore */
          }
        }

        if (rateLimited) {
          setCooldown({ until: Date.now() + 60_000, remainingSec: 60 });
          patchAsst((m) => ({
            ...m,
            content: m.content || "Rate-limited — retry in 60s",
            streaming: false,
          }));
          return;
        }

        const mutationResult = applyMutations(finalMutations);
        const replyText = finalReply ?? "(no reply)";
        patchAsst((m) => ({
          ...m,
          // If no text streamed, use the final reply. If text streamed, keep
          // it — the streamed content often includes intermediate reasoning
          // that the final reply summarizes; show whichever is richer.
          content: m.content.length > replyText.length ? m.content : replyText,
          mutationResult,
          streaming: false,
        }));
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // User cancelled — mark the placeholder as not-streaming and keep
          // whatever text arrived before cancel.
          patchAsst((m) => ({ ...m, streaming: false, content: m.content || "(cancelled)" }));
          return;
        }
        const msg = (err as Error).message ?? String(err);
        setError(msg);
        patchAsst((m) => ({ ...m, role: "system", streaming: false, content: `Error: ${msg}` }));
      } finally {
        setPending(false);
        abortRef.current = null;
      }
    },
    [pending, cooldown, messages.filter],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
    try {
      localStorage.removeItem(storageKeyForStem(stem));
    } catch {
      /* quota/private-mode */
    }
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
    setMessages((ms) => ms.map((m, i) => (i === targetIdx ? { ...m, undone: true } : m)));
  }, [messages]);

  // Index of the assistant message that would be undone next — used by the
  // UI to show the "Undo" button on only the most recent reversible turn.
  let undoableIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && !m.undone && m.mutationResult && hasUndo(m.mutationResult.undo)) {
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
