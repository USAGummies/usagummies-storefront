"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const HUMAN_REQUEST_REGEX =
  /\b(human|representative|representitive|agent|real person|live agent|someone)\b|talk to|speak to/i;
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_REGEX = /(\+?\d[\d\s().-]{7,}\d)/;
const HUMAN_PROMPT =
  "Happy to connect you with a representative. Please share your email or phone number and a brief note.";
const HUMAN_CONFIRMATION =
  "Thanks! Our team will reach out within one business day. If you have an order number, include it.";

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
  const [awaitingContact, setAwaitingContact] = useState(false);
  const sessionId = useMemo(() => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }, []);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sessionStartedAtRef = useRef<string | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentHumanRef = useRef(false);
  const sentFinalRef = useRef(false);
  const contactRef = useRef<{ email?: string; phone?: string } | null>(null);

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
  const inputPlaceholder = awaitingContact
    ? "Share your email or phone number"
    : "Ask about shipping, ingredients, or your order";

  const sendTranscript = useCallback(
    async (reason: "session_end" | "human_request", transcript?: ChatMessage[]) => {
      if (!sessionStartedAtRef.current) return;
      if (reason === "human_request") {
        if (sentHumanRef.current) return;
        sentHumanRef.current = true;
      } else {
        if (sentFinalRef.current) return;
        sentFinalRef.current = true;
      }

      try {
        await fetch("/api/chat/transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            reason,
            email: contactRef.current?.email,
            phone: contactRef.current?.phone,
            messages: (transcript ?? messages).map((message) => ({
              role: message.role,
              content: message.content,
            })),
            pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
            startedAt: sessionStartedAtRef.current,
            lastActiveAt: new Date(lastActivityRef.current).toISOString(),
          }),
        });
      } catch {
        // Best-effort; no UI impact.
      }
    },
    [messages, sessionId]
  );

  useEffect(() => {
    if (!sessionStartedAtRef.current) return;
    lastActivityRef.current = Date.now();
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    inactivityTimerRef.current = setTimeout(() => {
      sendTranscript("session_end");
    }, SESSION_TIMEOUT_MS);

    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, [messages, sendTranscript]);

  async function sendMessage() {
    const value = input.trim();
    if (!value || loading) return;
    if (!sessionStartedAtRef.current) {
      sessionStartedAtRef.current = new Date().toISOString();
    }
    lastActivityRef.current = Date.now();
    const userMessage: ChatMessage = { role: "user", content: value };
    if (awaitingContact) {
      const nextMessages = [...messages, userMessage];
      setMessages(nextMessages);
      setInput("");
      const emailMatch = value.match(EMAIL_REGEX)?.[0];
      const phoneMatch = value.match(PHONE_REGEX)?.[0];
      if (!emailMatch && !phoneMatch) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Please share an email or phone number so we can reach you.",
          },
        ]);
        return;
      }
      contactRef.current = {
        email: emailMatch || undefined,
        phone: phoneMatch || undefined,
      };
      setAwaitingContact(false);
      const confirmationMessage: ChatMessage = {
        role: "assistant",
        content: HUMAN_CONFIRMATION,
      };
      const transcriptMessages = [...nextMessages, confirmationMessage];
      setMessages(transcriptMessages);
      sendTranscript("human_request", transcriptMessages);
      return;
    }

    if (HUMAN_REQUEST_REGEX.test(value)) {
      const promptMessage: ChatMessage = {
        role: "assistant",
        content: HUMAN_PROMPT,
      };
      setMessages([...messages, userMessage, promptMessage]);
      setInput("");
      setAwaitingContact(true);
      return;
    }

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
              placeholder={inputPlaceholder}
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
