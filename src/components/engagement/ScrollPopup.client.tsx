"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";

const STORAGE_KEY = "usa-gummies-scroll-popup-dismissed";
const SUBMITTED_KEY = "exitIntent:submitted"; // shared with ExitIntentPopup
const DISMISS_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DELAY_MS = 8000; // 8 seconds
const SCROLL_THRESHOLD = 0.5; // 50% scroll depth

export default function ScrollPopup() {
  const [isVisible, setIsVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const hasTriggeredRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const wasDismissed = useCallback(() => {
    try {
      if (localStorage.getItem(SUBMITTED_KEY) === "true") return true;
      const ts = localStorage.getItem(STORAGE_KEY);
      if (!ts) return false;
      return Date.now() - Number(ts) < DISMISS_DURATION_MS;
    } catch {
      return false;
    }
  }, []);

  const dismiss = useCallback(() => {
    setIsVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      // silent
    }
  }, []);

  const show = useCallback(() => {
    if (hasTriggeredRef.current || wasDismissed()) return;
    hasTriggeredRef.current = true;
    setIsVisible(true);
    setTimeout(() => inputRef.current?.focus(), 200);
  }, [wasDismissed]);

  // Timer trigger
  useEffect(() => {
    if (wasDismissed()) return;
    const timer = setTimeout(() => show(), DELAY_MS);
    return () => clearTimeout(timer);
  }, [wasDismissed, show]);

  // Scroll trigger
  useEffect(() => {
    if (wasDismissed()) return;
    const handleScroll = () => {
      const pct = window.scrollY / (document.documentElement.scrollHeight - window.innerHeight);
      if (pct >= SCROLL_THRESHOLD) show();
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [wasDismissed, show]);

  // Escape to close
  useEffect(() => {
    if (!isVisible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isVisible, dismiss]);

  // Lock scroll
  useEffect(() => {
    if (!isVisible) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [isVisible]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || submitting) return;

    setSubmitting(true);
    setErrorMsg("");

    if (typeof window !== "undefined" && (window as any).gtag) {
      (window as any).gtag("event", "email_signup", {
        event_category: "engagement",
        event_label: "scroll_popup",
        value: email,
      });
    }

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "homepage-popup" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      try {
        localStorage.setItem(SUBMITTED_KEY, "true");
      } catch {
        // silent
      }
      setSubmitted(true);
      setTimeout(() => dismiss(), 2000);
    } catch {
      setErrorMsg("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  if (!isVisible) return null;

  return (
    <div
      ref={popupRef}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="scroll-popup-title"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-[rgba(15,27,45,0.1)] bg-[#f8f5ef] shadow-[0_32px_80px_rgba(15,27,45,0.25)]">
        {/* Close button */}
        <button
          onClick={dismiss}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-[var(--muted)] transition hover:bg-white hover:text-[var(--text)]"
          aria-label="Close popup"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M1 1l12 12M13 1L1 13" />
          </svg>
        </button>

        {/* Header */}
        <div className="relative h-20 bg-[#1B2A4A] overflow-hidden">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 50%, rgba(199,54,44,0.3), transparent 60%), radial-gradient(circle at 80% 50%, rgba(199,166,98,0.2), transparent 50%)",
            }}
          />
          <div className="relative flex h-full items-center justify-center gap-3">
            <Image
              src="/brand/logo-full.png"
              alt="USA Gummies"
              width={120}
              height={48}
              className="h-10 w-auto object-contain drop-shadow-lg"
            />
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-5 text-center">
          {submitted ? (
            <div className="py-4">
              <div className="text-3xl mb-2">&#127881;</div>
              <h3 className="text-lg font-bold text-[var(--text,#1B2A4A)]">
                You&rsquo;re in!
              </h3>
              <p className="mt-1 text-sm text-[var(--muted,#5f5b56)]">
                Check your inbox for your welcome email.
              </p>
            </div>
          ) : (
            <>
              <h2
                id="scroll-popup-title"
                className="text-xl font-black text-[var(--text,#1B2A4A)] sm:text-2xl"
              >
                Stay in the Loop
              </h2>
              <p className="mt-2 text-sm text-[var(--muted,#5f5b56)]">
                Get <strong className="text-[var(--text,#1B2A4A)]">new flavor drops, recipes, and Made in USA stories</strong> delivered to your inbox. No spam, ever.
              </p>

              {/* Trust pills */}
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {["Made in USA", "No Artificial Dyes", "Free Shipping on 5+"].map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full border border-[rgba(15,27,45,0.1)] bg-white px-3 py-1 text-[11px] font-semibold text-[var(--text,#1B2A4A)]"
                  >
                    <span className="text-[#2D7A3A]">&#10003;</span> {tag}
                  </span>
                ))}
              </div>

              {/* Email form */}
              <form onSubmit={handleSubmit} className="mt-5">
                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    required
                    className="flex-1 rounded-xl border border-[rgba(15,27,45,0.15)] bg-white px-4 py-3 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[rgba(199,54,44,0.3)]"
                    aria-label="Email address"
                  />
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn btn-candy pressable whitespace-nowrap px-5 py-3 text-sm font-bold disabled:opacity-60"
                  >
                    {submitting ? "Sending\u2026" : "Join free"}
                  </button>
                </div>
                {errorMsg && (
                  <p className="mt-2 text-xs text-red-600">{errorMsg}</p>
                )}
              </form>

              <button
                onClick={dismiss}
                className="mt-3 text-xs text-[var(--muted,#5f5b56)] underline underline-offset-4 hover:text-[var(--text)]"
              >
                No thanks
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
