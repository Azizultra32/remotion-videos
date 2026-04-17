import { useEffect, useRef, useState } from "react";
import { useChat, type ChatMessage } from "../hooks/useChat";

export const ChatPane = () => {
  const { messages, pending, send, cancel, clear } = useChat();
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending]);

  const submit = () => {
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    void send(text);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
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
        <span style={{ fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", fontSize: 11 }}>
          Chat
        </span>
        <button
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
          <div style={{ color: "#666", fontSize: 11, lineHeight: 1.5 }}>
            Tell me what to build. Examples:
            <ul style={{ margin: "8px 0 0 0", paddingLeft: 18 }}>
              <li>Add a beat-drop title starting at 12:12 for 18 seconds.</li>
              <li>Put spectrum bars at the bottom, purple.</li>
              <li>Seek to 30 seconds and play.</li>
            </ul>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {pending && (
          <div style={{ color: "#888", fontStyle: "italic", fontSize: 11 }}>
            Thinking…
          </div>
        )}
      </div>

      <div style={{ borderTop: "1px solid #333", padding: 8, background: "#0a0a0a" }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Describe what you want — Enter to send, Shift+Enter for newline"
          rows={3}
          disabled={pending}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#1a1a1a",
            color: "#fff",
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
              onClick={submit}
              disabled={!input.trim()}
              style={{
                background: input.trim() ? "#1a3a1a" : "#222",
                border: "1px solid #2a5",
                color: input.trim() ? "#8f8" : "#555",
                padding: "4px 12px",
                fontSize: 11,
                cursor: input.trim() ? "pointer" : "not-allowed",
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

const MessageBubble = ({ message }: { message: ChatMessage }) => {
  const { mutationResult } = message;
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
          }}
        >
          <span>
            {mutationResult.applied} applied
            {mutationResult.skipped > 0 ? `, ${mutationResult.skipped} skipped` : ""}
          </span>
          {mutationResult.errors.length > 0 && (
            <span style={{ color: "#f87171" }} title={mutationResult.errors.join("\n")}>
              {mutationResult.errors.length} error{mutationResult.errors.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
