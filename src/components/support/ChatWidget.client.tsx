"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const STORAGE_KEY = "usa_gummies_support_chat";
const STARTER: ChatMessage[] = [
  {
    role: "assistant",
    content:
      "Hi! I can help with shipping, ingredients, bag counts, or order questions. What can I help with?",
  },
];

const QUICK_LINKS = [
  { label: "Shipping", href: "/policies/shipping" },
  { label: "Returns", href: "/policies/returns" },
  { label: "Ingredients", href: "/ingredients" },
  { label: "FAQ", href: "/faq" },
];

function safeParse(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(STARTER);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const stored = safeParse(
      typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null
    );
    if (stored?.messages?.length) {
      setMessages(stored.messages as ChatMessage[]);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ messages: messages.slice(-12) })
    );
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [messages, loading]);

  const trimmedMessages = useMemo(() => messages.slice(-8), [messages]);

  async function sendMessage() {
    const value = input.trim();
    if (!value || loading) return;
    const userMessage: ChatMessage = { role: "user", content: value };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: trimmedMessages.concat(userMessage) }),
      });
      const data = await res.json();
      if (res.ok && data?.reply) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "Sorry - I could not reach support right now. Please use the contact form and we will respond within one business day.",
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Sorry - the chat is unavailable right now. Please use the contact form and we will respond within one business day.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    sendMessage();
  }

  return (
    <div className="support-chat">
      {open ? (
        <div className="support-chat__panel" role="dialog" aria-label="USA Gummies support chat">
          <div className="support-chat__header">
            <div>
              <div className="support-chat__title">USA Gummies Support</div>
              <div className="support-chat__sub">Average reply: within 1 business day</div>
            </div>
            <button type="button" className="support-chat__close" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>

          <div className="support-chat__links">
            {QUICK_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="support-chat__link">
                {link.label}
              </Link>
            ))}
            <Link href="/contact" className="support-chat__link support-chat__link--primary">
              Contact support
            </Link>
          </div>

          <div className="support-chat__body" ref={scrollerRef} aria-live="polite">
            {messages.map((message, idx) => (
              <div
                key={`${message.role}-${idx}`}
                className={`support-chat__bubble support-chat__bubble--${message.role}`}
              >
                {message.content}
              </div>
            ))}
            {loading ? (
              <div className="support-chat__bubble support-chat__bubble--assistant">
                Typing...
              </div>
            ) : null}
          </div>

          <form className="support-chat__form" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about shipping, ingredients, or your order"
              className="support-chat__input"
              maxLength={600}
              aria-label="Type your message"
            />
            <button type="submit" className="support-chat__send">
              Send
            </button>
          </form>
          <div className="support-chat__footnote">
            This assistant can help with general questions. For order-specific issues, use{" "}
            <Link href="/contact">contact support</Link>.
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="support-chat__launcher"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Open support chat"
      >
        {open ? "Close chat" : "Chat with us"}
      </button>
    </div>
  );
}
