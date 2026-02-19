"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";

const STORAGE_KEY = "usa-gummies-exit-popup-dismissed";
const SUBMITTED_KEY = "exitIntent:submitted";
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DELAY_BEFORE_ACTIVE_MS = 8000; // Wait 8s before arming
const MOBILE_SCROLL_THRESHOLD = 0.55; // 55% scroll depth on mobile

export default function ExitIntentPopup() {
  const [isVisible, setIsVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isArmed, setIsArmed] = useState(false);
  const hasTriggeredRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Check if previously dismissed or already submitted
  const wasDismissed = useCallback(() => {
    try {
      if (localStorage.getItem(SUBMITTED_KEY) === "true") return true;
      const ts = localStorage.getItem(STORAGE_KEY);
      if (!ts) return false;
      const elapsed = Date.now() - Number(ts);
      return elapsed < DISMISS_DURATION_MS;
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
    // Focus the input after a short delay
    setTimeout(() => inputRef.current?.focus(), 200);
  }, [wasDismissed]);

  // Arm the popup after a delay
  useEffect(() => {
    if (wasDismissed()) return;
    const timer = setTimeout(() => setIsArmed(true), DELAY_BEFORE_ACTIVE_MS);
    return () => clearTimeout(timer);
  }, [wasDismissed]);

  // Desktop: mouseleave on document (exit intent)
  useEffect(() => {
    if (!isArmed) return;

    const handleMouseLeave = (e: MouseEvent) => {
      // Only trigger when mouse exits toward the top of viewport (closing tab / back button)
      if (e.clientY <= 5 && e.relatedTarget === null) {
        show();
      }
    };

    document.addEventListener("mouseleave", handleMouseLeave);
    return () => document.removeEventListener("mouseleave", handleMouseLeave);
  }, [isArmed, show]);

  // Mobile: trigger on scroll-up after deep scroll (intent to leave)
  useEffect(() => {
    if (!isArmed) return;

    let maxScroll = 0;
    let hasPassedThreshold = false;

    const handleScroll = () => {
      const scrollPercent =
        window.scrollY / (document.documentElement.scrollHeight - window.innerHeight);

      if (scrollPercent > maxScroll) {
        maxScroll = scrollPercent;
      }

      // User scrolled past threshold, then scrolled back up significantly
      if (maxScroll >= MOBILE_SCROLL_THRESHOLD) {
        hasPassedThreshold = true;
      }

      if (hasPassedThreshold && scrollPercent < maxScroll - 0.15) {
        show();
      }
    };

    // Only add scroll listener on mobile
    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    if (isMobile) {
      window.addEventListener("scroll", handleScroll, { passive: true });
      return () => window.removeEventListener("scroll", handleScroll);
    }
  }, [isArmed, show]);

  // Close on Escape
  useEffect(() => {
    if (!isVisible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isVisible, dismiss]);

  // Lock body scroll when open
  useEffect(() => {
    if (!isVisible) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [isVisible]);

  // Focus trap: trap Tab/Shift+Tab within the popup
  useEffect(() => {
    if (!isVisible || !popupRef.current) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const focusableSelector =
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
    const focusableElements = popupRef.current.querySelectorAll<HTMLElement>(focusableSelector);
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;

      const currentFocusables = popupRef.current?.querySelectorAll<HTMLElement>(focusableSelector);
      if (!currentFocusables || currentFocusables.length === 0) return;

      const first = currentFocusables[0];
      const last = currentFocusables[currentFocusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === "function") {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [isVisible]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || submitting) return;

    setSubmitting(true);
    setErrorMsg("");

    // Fire GA4 event
    if (typeof window !== "undefined" && (window as any).gtag) {
      (window as any).gtag("event", "email_signup", {
        event_category: "engagement",
        event_label: "exit_intent_popup",
        value: email,
      });
    }

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "exit-intent" }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }

      // Mark as submitted so popup never shows again
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
      aria-labelledby="exit-popup-title"
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

        {/* Header accent */}
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
              <div className="text-3xl mb-2">🎉</div>
              <h3 className="text-lg font-bold text-[var(--text,#1B2A4A)]">
                You&rsquo;re in!
              </h3>
              <p className="mt-1 text-sm text-[var(--muted,#5f5b56)]">
                Check your inbox for your welcome offer.
              </p>
            </div>
          ) : (
            <>
              <h2
                id="exit-popup-title"
                className="text-xl font-black text-[var(--text,#1B2A4A)] sm:text-2xl"
              >
                Wait&mdash;don&rsquo;t leave empty-handed!
              </h2>
              <p className="mt-2 text-sm text-[var(--muted,#5f5b56)]">
                Join the Gummy Revolution and get <strong className="text-[var(--text,#1B2A4A)]">exclusive deals, early access to new flavors</strong>, and member-only savings.
              </p>

              {/* Value props */}
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {["Early access", "Member savings", "No spam"].map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full border border-[rgba(15,27,45,0.1)] bg-white px-3 py-1 text-[11px] font-semibold text-[var(--text,#1B2A4A)]"
                  >
                    <span className="text-[#2D7A3A]">✓</span> {tag}
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
                No thanks, I&rsquo;ll pass
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
