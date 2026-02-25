"use client";

import { useChat } from "@ai-sdk/react";
import { useState, useRef, useEffect, useCallback } from "react";
import { MessageSquare, X, Send, Loader2, Sparkles, RotateCcw } from "lucide-react";

// ---------------------------------------------------------------------------
// Constants (match OpsDashboard theme)
// ---------------------------------------------------------------------------

const C = {
  bg: "#0f1117",
  card: "#1a1d27",
  border: "rgba(255,255,255,0.06)",
  borderHover: "rgba(255,255,255,0.12)",
  text: "rgba(255,255,255,0.9)",
  textSecondary: "rgba(255,255,255,0.55)",
  textMuted: "rgba(255,255,255,0.35)",
  textFaint: "rgba(255,255,255,0.2)",
  blue: "#7c8cf5",
  green: "#43c46b",
  amber: "#ff9f43",
};

const SUGGESTED_PROMPTS = [
  "How are sales today?",
  "Show me this week's revenue trend",
  "What's our FBA inventory status?",
  "How's cash flow looking?",
  "Compare this week vs last week",
];

// ---------------------------------------------------------------------------
// Chat Panel
// ---------------------------------------------------------------------------

export function OpsChat() {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { messages, input, handleInputChange, handleSubmit, isLoading, setMessages } =
    useChat({
      api: "/api/ops/chat",
      initialMessages: [],
    });

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Keyboard shortcut: Cmd+K to toggle
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSuggestedPrompt = useCallback(
    (prompt: string) => {
      const fakeEvent = {
        preventDefault: () => {},
      } as React.FormEvent;

      // Set the input value by simulating change, then submit
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      if (inputRef.current && nativeInputValueSetter) {
        nativeInputValueSetter.call(inputRef.current, prompt);
        inputRef.current.dispatchEvent(new Event("input", { bubbles: true }));
      }
      // Use a slight delay for the state to sync
      setTimeout(() => handleSubmit(fakeEvent), 50);
    },
    [handleSubmit],
  );

  return (
    <>
      {/* Injected styles */}
      <style>{`
        @keyframes chatSlideIn {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes chatFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .ops-chat-bubble {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 52px;
          height: 52px;
          border-radius: 16px;
          background: linear-gradient(135deg, ${C.blue}, #6366f1);
          border: none;
          cursor: pointer;
          box-shadow: 0 4px 24px rgba(124,140,245,0.3), 0 1px 3px rgba(0,0,0,0.2);
          transition: all 0.2s ease;
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 1000;
        }
        .ops-chat-bubble:hover {
          transform: scale(1.08);
          box-shadow: 0 6px 32px rgba(124,140,245,0.4), 0 2px 4px rgba(0,0,0,0.3);
        }
        .ops-chat-msg-user {
          background: rgba(124,140,245,0.12);
          border: 1px solid rgba(124,140,245,0.2);
          border-radius: 14px 14px 4px 14px;
          padding: 10px 16px;
          margin-left: auto;
          max-width: 80%;
          font-size: 13px;
          color: ${C.text};
          line-height: 1.5;
        }
        .ops-chat-msg-ai {
          background: rgba(255,255,255,0.03);
          border: 1px solid ${C.border};
          border-radius: 14px 14px 14px 4px;
          padding: 10px 16px;
          max-width: 90%;
          font-size: 13px;
          color: ${C.textSecondary};
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .ops-chat-msg-ai strong { color: ${C.text}; font-weight: 600; }
        .ops-chat-msg-ai code {
          background: rgba(255,255,255,0.06);
          padding: 1px 5px;
          border-radius: 4px;
          font-size: 12px;
        }
      `}</style>

      {/* ── Floating chat button ─────────────────────────────────── */}
      {!open && (
        <button
          className="ops-chat-bubble"
          onClick={() => setOpen(true)}
          title="Ask AI (⌘K)"
        >
          <MessageSquare size={22} color="white" strokeWidth={2} />
        </button>
      )}

      {/* ── Chat panel ───────────────────────────────────────────── */}
      {open && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            width: 400,
            maxHeight: "calc(100vh - 48px)",
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: 18,
            display: "flex",
            flexDirection: "column",
            zIndex: 1001,
            boxShadow: "0 12px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)",
            animation: "chatSlideIn 0.25s ease both",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 18px",
              borderBottom: `1px solid ${C.border}`,
              background: C.card,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={15} color={C.blue} strokeWidth={2} />
              <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                Ops AI
              </span>
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 7px",
                  borderRadius: 5,
                  background: "rgba(124,140,245,0.1)",
                  color: C.blue,
                  fontWeight: 500,
                }}
              >
                gpt-4o-mini
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                onClick={() => setMessages([])}
                title="Clear conversation"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  color: C.textMuted,
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                  e.currentTarget.style.color = C.textSecondary;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = C.textMuted;
                }}
              >
                <RotateCcw size={14} strokeWidth={1.8} />
              </button>
              <button
                onClick={() => setOpen(false)}
                title="Close (⌘K)"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  color: C.textMuted,
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                  e.currentTarget.style.color = C.textSecondary;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = C.textMuted;
                }}
              >
                <X size={16} strokeWidth={1.8} />
              </button>
            </div>
          </div>

          {/* Messages area */}
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              minHeight: 300,
              maxHeight: "calc(100vh - 200px)",
            }}
          >
            {/* Welcome message if no messages */}
            {messages.length === 0 && (
              <div
                style={{
                  animation: "chatFadeIn 0.3s ease both",
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  paddingTop: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 14,
                    color: C.textSecondary,
                    lineHeight: 1.5,
                  }}
                >
                  Ask me anything about your business — revenue, orders,
                  inventory, agents, or cash position. I have access to live
                  data.
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                  }}
                >
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => handleSuggestedPrompt(prompt)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        border: `1px solid ${C.border}`,
                        background: "transparent",
                        color: C.textMuted,
                        fontSize: 12,
                        cursor: "pointer",
                        transition: "all 0.15s",
                        whiteSpace: "nowrap",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = C.blue;
                        e.currentTarget.style.color = C.text;
                        e.currentTarget.style.background =
                          "rgba(124,140,245,0.06)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = C.border;
                        e.currentTarget.style.color = C.textMuted;
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Chat messages */}
            {messages
              .filter((m) => m.role === "user" || m.role === "assistant")
              .map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    display: "flex",
                    justifyContent:
                      msg.role === "user" ? "flex-end" : "flex-start",
                    animation: "chatFadeIn 0.2s ease both",
                  }}
                >
                  <div
                    className={
                      msg.role === "user"
                        ? "ops-chat-msg-user"
                        : "ops-chat-msg-ai"
                    }
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

            {/* Loading indicator */}
            {isLoading && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: C.textMuted,
                  fontSize: 12,
                  animation: "chatFadeIn 0.2s ease both",
                }}
              >
                <Loader2
                  size={14}
                  strokeWidth={2}
                  style={{ animation: "spin 1s linear infinite" }}
                />
                <span>Thinking...</span>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}
          </div>

          {/* Input area */}
          <form
            onSubmit={handleSubmit}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 14px",
              borderTop: `1px solid ${C.border}`,
              background: C.card,
            }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              placeholder="Ask about revenue, orders, inventory..."
              disabled={isLoading}
              style={{
                flex: 1,
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: "10px 14px",
                color: C.text,
                fontSize: 13,
                outline: "none",
                transition: "border-color 0.15s",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "rgba(124,140,245,0.4)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = C.border;
              }}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 38,
                height: 38,
                borderRadius: 10,
                border: "none",
                background:
                  isLoading || !input.trim()
                    ? "rgba(255,255,255,0.04)"
                    : `linear-gradient(135deg, ${C.blue}, #6366f1)`,
                cursor: isLoading || !input.trim() ? "default" : "pointer",
                transition: "all 0.15s",
              }}
            >
              <Send
                size={16}
                color={
                  isLoading || !input.trim()
                    ? C.textFaint
                    : "white"
                }
                strokeWidth={2}
              />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
