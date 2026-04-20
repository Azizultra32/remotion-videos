import { useEffect, useRef, useState } from "react";
import { type ChatMessage, useChat } from "../hooks/useChat";

export const ChatPane = () => {
  const { messages, pending, cooldown, undoableIndex, send, cancel, clear, undoLastTurn } =
    useChat();
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const cooling = Boolean(cooldown && cooldown.remainingSec > 0);
  const inputDisabled = pending || cooling;

  const submit = () => {
    const text = input.trim();
    if (!text || inputDisabled) return;
    setInput("");
    void send(text);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter") return;
    // Shift+Enter → newline (default textarea behavior).
    if (e.shiftKey) return;
    // Plain Enter OR Cmd/Ctrl+Enter → submit.
    e.preventDefault();
    submit();
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#0f0f0f",
        fontSize: 12,
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid #333",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#151515",
        }}
      >
        <span
          style={{
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            fontSize: 11,
          }}
        >
          Chat
        </span>
        <button
          type="button"
          onClick={clear}
          disabled={pending || messages.length === 0}
          style={{
            background: "transparent",
            border: "1px solid #444",
            color: "#aaa",
            padding: "2px 8px",
            fontSize: 10,
            cursor: pending || messages.length === 0 ? "not-allowed" : "pointer",
            borderRadius: 3,
          }}
        >
          Clear
        </button>
      </div>

      {cooling && (
        <div
          style={{
            padding: "8px 12px",
            background: "#3a2a0f",
            borderBottom: "1px solid #7a5a1a",
            color: "#fbbf24",
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 13 }}>&#9888;</span>
          <span>Claude CLI rate-limited — retry in {cooldown?.remainingSec}s</span>
        </div>
      )}

      <div
        ref={listRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {messages.length === 0 && !pending && (
          <div style={{ color: "#888", fontSize: 11, lineHeight: 1.55 }}>
            <div style={{ color: "#aaa", marginBottom: 6 }}>
              Tell me what to build or what to do.
            </div>
            <div
              style={{
                color: "#666",
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginTop: 10,
                marginBottom: 4,
              }}
            >
              Timeline edits
            </div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>Add a beat-drop title at 12:12 for 18 seconds.</li>
              <li>Put spectrum bars at the bottom, purple.</li>
              <li>Seek to 30 and play.</li>
            </ul>
            <div
              style={{
                color: "#666",
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginTop: 10,
                marginBottom: 4,
              }}
            >
              Project lifecycle (no CLI)
            </div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>Bring in the track at /Users/me/tracks/song.mp3.</li>
              <li>Seed beats for the current track.</li>
              <li>Re-analyze this track.</li>
              <li>Switch to dubfire-sake.</li>
              <li>Clear the pipeline events.</li>
            </ul>
            <details style={{ marginTop: 14 }}>
              <summary
                style={{ cursor: "pointer", color: "#8cf", fontSize: 11, userSelect: "none" }}
              >
                What can I say?
              </summary>
              <div style={{ marginTop: 8, color: "#888", fontSize: 10.5, lineHeight: 1.5 }}>
                The chat maps natural language to store mutations + HTTP calls.
                <ul style={{ margin: "6px 0 0 0", paddingLeft: 16 }}>
                  <li>
                    <code>addElement</code> — any of the 16 element types (text.bellCurve,
                    text.beatDrop, audio.spectrumBars, shape.sonarRings, overlay.videoClip, …).
                  </li>
                  <li>
                    <code>updateElement</code> / <code>removeElement</code> — tweak or delete by id.
                  </li>
                  <li>
                    <code>seekTo</code> / <code>setPlaying</code> — jump the playhead, play/pause.
                  </li>
                  <li>
                    <code>scaffold</code> — absolute audio path → new project + auto-analyze.
                  </li>
                  <li>
                    <code>analyze</code> / <code>seedBeats</code> / <code>clearEvents</code> —
                    per-project pipeline control.
                  </li>
                  <li>
                    <code>switchTrack</code> — load a different existing project.
                  </li>
                </ul>
                One-shot per turn — no memory across messages yet. Undo is per-turn via the Undo
                chip on each reply.
              </div>
            </details>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageBubble
            key={m.id}
            message={m}
            showUndo={i === undoableIndex}
            onUndo={undoLastTurn}
          />
        ))}
        {pending && (
          <div style={{ color: "#888", fontStyle: "italic", fontSize: 11 }}>Thinking&#8230;</div>
        )}
      </div>

      <div style={{ borderTop: "1px solid #333", padding: 8, background: "#0a0a0a" }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            cooling
              ? `Cooling down — ${cooldown?.remainingSec}s remaining`
              : "Describe what you want — Enter or ⌘↩ to send, Shift+Enter for newline"
          }
          rows={3}
          disabled={inputDisabled}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: inputDisabled ? "#111" : "#1a1a1a",
            color: inputDisabled ? "#666" : "#fff",
            border: "1px solid #333",
            borderRadius: 4,
            padding: 8,
            fontSize: 12,
            fontFamily: "inherit",
            resize: "none",
            outline: "none",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
          {pending ? (
            <button
              type="button"
              onClick={cancel}
              style={{
                background: "#3a1a1a",
                border: "1px solid #552",
                color: "#f88",
                padding: "4px 12px",
                fontSize: 11,
                cursor: "pointer",
                borderRadius: 3,
              }}
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!input.trim() || inputDisabled}
              style={{
                background: input.trim() && !inputDisabled ? "#1a3a1a" : "#222",
                border: "1px solid #2a5",
                color: input.trim() && !inputDisabled ? "#8f8" : "#555",
                padding: "4px 12px",
                fontSize: 11,
                cursor: input.trim() && !inputDisabled ? "pointer" : "not-allowed",
                borderRadius: 3,
              }}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const roleStyle = (role: ChatMessage["role"]): React.CSSProperties => {
  if (role === "user") {
    return { alignSelf: "flex-end", background: "#1e3a5f", color: "#dbeafe", maxWidth: "90%" };
  }
  if (role === "system") {
    return { alignSelf: "stretch", background: "#3a1a1a", color: "#fca5a5", maxWidth: "100%" };
  }
  return { alignSelf: "flex-start", background: "#1a1a1a", color: "#e5e5e5", maxWidth: "90%" };
};

const MessageBubble = ({
  message,
  showUndo,
  onUndo,
}: {
  message: ChatMessage;
  showUndo: boolean;
  onUndo: () => void;
}) => {
  const { mutationResult, toolCalls = [], streaming } = message;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <div
      style={{
        ...roleStyle(message.role),
        padding: "8px 10px",
        borderRadius: 6,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        lineHeight: 1.45,
        fontSize: 12,
      }}
    >
      {message.content}
      {streaming && (
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 12,
            marginLeft: 2,
            background: "#93c5fd",
            verticalAlign: "middle",
            animation: "pulse 1s ease-in-out infinite",
            opacity: 0.8,
          }}
        />
      )}
      {toolCalls.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {toolCalls.map((tc) => {
            const running = tc.result === undefined;
            const isExpanded = expanded.has(tc.id || tc.name);
            const inputSummary = (() => {
              try {
                const s = JSON.stringify(tc.input);
                return s.length > 60 ? `${s.slice(0, 60)}…` : s;
              } catch {
                return "";
              }
            })();
            const chipColor = tc.isError ? "#7f1d1d" : running ? "#1e3a5f" : "#1e3a2a";
            const chipBorder = tc.isError ? "#b91c1c" : running ? "#3b82f6" : "#22c55e";
            const chipText = tc.isError ? "#fca5a5" : running ? "#93c5fd" : "#86efac";
            return (
              {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-driven editor canvas; keyboard UI is separate */}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: pointer-driven editor canvas; keyboard UI is separate */}
              <div
                key={tc.id || tc.name}
                style={{
                  fontSize: 10,
                  fontFamily: "monospace",
                  background: chipColor,
                  border: `1px solid ${chipBorder}`,
                  borderRadius: 3,
                  color: chipText,
                  padding: "3px 6px",
                  cursor: "pointer",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
                onClick={() => toggle(tc.id || tc.name)}
                title={isExpanded ? "Click to collapse" : "Click to expand input + result"}
              >
                <div>
                  <span style={{ fontWeight: 600 }}>{tc.name}</span>{" "}
                  <span style={{ opacity: 0.7 }}>
                    {running ? "running…" : tc.isError ? "error" : "done"}
                  </span>
                  {!isExpanded && inputSummary ? (
                    <span style={{ marginLeft: 6, opacity: 0.6 }}>{inputSummary}</span>
                  ) : null}
                </div>
                {isExpanded && (
                  <div
                    style={{
                      marginTop: 4,
                      paddingTop: 4,
                      borderTop: "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    <div style={{ opacity: 0.7 }}>input:</div>
                    <div>{inputSummary.replace(/…$/, "") || "(empty)"}</div>
                    {(() => {
                      // If this is a Read of an image file under projects/,
                      // render an inline preview. Looks up the file_path on
                      // the tool_use input and builds a /api/projects/<rel>
                      // URL that the sidecar can stream.
                      if (tc.name !== "Read") return null;
                      const input = tc.input as { file_path?: unknown };
                      const fp = typeof input?.file_path === "string" ? input.file_path : "";
                      if (!/\.(png|jpe?g|gif|webp)$/i.test(fp)) return null;
                      const m = fp.match(/\/projects\/(.+)$/);
                      if (!m) return null;
                      const url = `/api/projects/${m[1]}`;
                      return (
                        <>
                          <div style={{ opacity: 0.7, marginTop: 4 }}>preview:</div>
                          <img
                            src={url}
                            alt={fp}
                            style={{
                              maxWidth: "100%",
                              maxHeight: 200,
                              borderRadius: 3,
                              marginTop: 2,
                              background: "#000",
                              display: "block",
                            }}
                          />
                        </>
                      );
                    })()}
                    {tc.result !== undefined && (
                      <>
                        <div style={{ opacity: 0.7, marginTop: 4 }}>result:</div>
                        <div>
                          {tc.result.slice(0, 1200) || "(empty)"}
                          {tc.result.length > 1200 ? "… (truncated)" : ""}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {mutationResult && (mutationResult.applied > 0 || mutationResult.skipped > 0) && (
        <div
          style={{
            marginTop: 6,
            paddingTop: 6,
            borderTop: "1px solid rgba(255,255,255,0.08)",
            fontSize: 10,
            color: "#9ca3af",
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span>
            {mutationResult.applied} applied
            {mutationResult.skipped > 0 ? `, ${mutationResult.skipped} skipped` : ""}
            {message.undone ? " — undone" : ""}
          </span>
          {mutationResult.errors.length > 0 && (
            <span style={{ color: "#f87171" }} title={mutationResult.errors.join("\n")}>
              {mutationResult.errors.length} error{mutationResult.errors.length === 1 ? "" : "s"}
            </span>
          )}
          {showUndo && !message.undone && (
            <button
              type="button"
              onClick={onUndo}
              style={{
                marginLeft: "auto",
                background: "transparent",
                border: "1px solid #555",
                color: "#d1d5db",
                padding: "2px 8px",
                fontSize: 10,
                cursor: "pointer",
                borderRadius: 3,
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
};
