"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  NAVY,
  GOLD,
  CREAM,
  RED,
  SURFACE_CARD,
  SURFACE_BORDER,
  SURFACE_TEXT_DIM,
} from "@/app/ops/tokens";

type Source = {
  id: string;
  source_table: "brain" | "email";
  title: string;
  similarity: number;
  metadata?: Record<string, unknown>;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
};

const QUICK_STARTS = [
  "Recent important emails",
  "B2B pipeline status",
  "Supply chain updates",
  "Financial summary",
];

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AbraChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const historyPayload = useMemo(
    () =>
      messages.slice(-12).map((message) => ({
        role: message.role,
        content: message.content,
      })),
    [messages],
  );

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, pending]);

  async function sendMessage(text: string) {
    const message = text.trim();
    if (!message || pending) return;

    setError(null);
    setPending(true);

    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: message,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    try {
      const res = await fetch("/api/ops/abra/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: historyPayload,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof data?.error === "string" ? data.error : "Chat request failed";
        throw new Error(msg);
      }

      const assistantMessage: ChatMessage = {
        id: makeId(),
        role: "assistant",
        content: typeof data?.reply === "string" ? data.reply : "No response returned.",
        sources: Array.isArray(data?.sources) ? data.sources : [],
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setPending(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await sendMessage(input);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: CREAM,
        padding: 20,
      }}
    >
      <div
        style={{
          maxWidth: 980,
          margin: "0 auto",
          display: "grid",
          gap: 12,
        }}
      >
        <div
          style={{
            border: `1px solid ${SURFACE_BORDER}`,
            borderRadius: 14,
            background: SURFACE_CARD,
            padding: "14px 16px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <span style={{ fontSize: 20 }}>{"\u{1F9E0}"}</span>
            <h1
              style={{
                margin: 0,
                color: NAVY,
                fontSize: 22,
                lineHeight: 1.2,
              }}
            >
              Abra
            </h1>
          </div>
          <p
            style={{
              margin: 0,
              color: SURFACE_TEXT_DIM,
              fontSize: 13,
            }}
          >
            Ask across emails + operations memory.
          </p>
        </div>

        <div
          ref={listRef}
          style={{
            border: `1px solid ${SURFACE_BORDER}`,
            borderRadius: 14,
            background: "#fff",
            minHeight: 480,
            maxHeight: "62vh",
            overflowY: "auto",
            padding: 16,
            display: "grid",
            gap: 12,
          }}
        >
          {messages.length === 0 && (
            <div
              style={{
                display: "grid",
                gap: 10,
                alignContent: "start",
              }}
            >
              <p
                style={{
                  margin: 0,
                  color: SURFACE_TEXT_DIM,
                  fontSize: 13,
                }}
              >
                Quick starts
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {QUICK_STARTS.map((item) => (
                  <button
                    key={item}
                    onClick={() => void sendMessage(item)}
                    style={{
                      border: `1px solid ${SURFACE_BORDER}`,
                      borderRadius: 999,
                      background: "#fff",
                      color: NAVY,
                      fontSize: 12,
                      padding: "6px 10px",
                      cursor: pending ? "default" : "pointer",
                      opacity: pending ? 0.7 : 1,
                    }}
                    disabled={pending}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => {
            const isUser = message.role === "user";
            return (
              <div
                key={message.id}
                style={{
                  display: "grid",
                  justifyItems: isUser ? "end" : "start",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    maxWidth: "90%",
                    borderRadius: 12,
                    border: isUser ? `1px solid ${GOLD}` : `1px solid ${NAVY}`,
                    background: isUser ? "#fffdf8" : NAVY,
                    color: isUser ? "#1f2f55" : "#ffffff",
                    padding: "10px 12px",
                    whiteSpace: "pre-wrap",
                    fontSize: 14,
                    lineHeight: 1.45,
                  }}
                >
                  {message.content}
                </div>

                {!isUser && message.sources && message.sources.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {message.sources.map((source) => (
                      <span
                        key={`${message.id}-${source.id}`}
                        title={source.title}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 11,
                          color: NAVY,
                          border: `1px solid ${SURFACE_BORDER}`,
                          background: "#fff",
                          borderRadius: 999,
                          padding: "4px 8px",
                        }}
                      >
                        <strong style={{ color: source.source_table === "email" ? RED : NAVY }}>
                          {source.source_table.toUpperCase()}
                        </strong>
                        <span
                          style={{
                            maxWidth: 220,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {source.title}
                        </span>
                        <span style={{ color: SURFACE_TEXT_DIM }}>
                          {Number(source.similarity || 0).toFixed(2)}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {pending && (
            <div
              style={{
                color: SURFACE_TEXT_DIM,
                fontSize: 13,
              }}
            >
              Abra is thinking...
            </div>
          )}
        </div>

        <form
          onSubmit={onSubmit}
          style={{
            border: `1px solid ${SURFACE_BORDER}`,
            borderRadius: 14,
            background: "#fff",
            padding: 12,
            display: "flex",
            gap: 8,
          }}
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask Abra about distributors, finance, supply chain, or email activity..."
            style={{
              flex: 1,
              border: `1px solid ${SURFACE_BORDER}`,
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 14,
              outline: "none",
            }}
            disabled={pending}
          />
          <button
            type="submit"
            disabled={pending || !input.trim()}
            style={{
              border: `1px solid ${NAVY}`,
              background: NAVY,
              color: "#fff",
              borderRadius: 10,
              padding: "0 14px",
              fontSize: 13,
              cursor: pending || !input.trim() ? "default" : "pointer",
              opacity: pending || !input.trim() ? 0.7 : 1,
            }}
          >
            Send
          </button>
        </form>

        {error && (
          <div
            style={{
              border: `1px solid rgba(199,54,44,0.35)`,
              background: "rgba(199,54,44,0.06)",
              borderRadius: 10,
              color: RED,
              fontSize: 13,
              padding: "8px 10px",
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

