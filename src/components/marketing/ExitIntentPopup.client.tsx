"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { LeadCapture } from "./LeadCapture.client";
import { trackEvent } from "@/lib/analytics";

const STORAGE_KEY = "exit_popup_dismissed";
const DISMISS_DAYS = 7;
const MIN_PAGE_TIME_MS = 8_000;

function wasDismissedRecently(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

function markDismissed() {
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

export function ExitIntentPopup() {
  const [show, setShow] = useState(false);
  const fired = useRef(false);
  const pageStart = useRef(Date.now());

  const trigger = useCallback(() => {
    if (fired.current) return;
    if (wasDismissedRecently()) return;
    if (Date.now() - pageStart.current < MIN_PAGE_TIME_MS) return;
    fired.current = true;
    setShow(true);
    trackEvent("exit_intent_popup_shown", {});
  }, []);

  const dismiss = useCallback(() => {
    setShow(false);
    markDismissed();
    trackEvent("exit_intent_popup_dismissed", {});
  }, []);

  useEffect(() => {
    if (wasDismissedRecently()) return;

    // Desktop: mouse leaves viewport toward top
    function onMouseLeave(e: MouseEvent) {
      if (e.clientY <= 5) trigger();
    }

    // Mobile: back button / history popstate
    function onPopState() {
      trigger();
      // Re-push state so we don't actually navigate away
      window.history.pushState(null, "", window.location.href);
    }

    document.addEventListener("mouseleave", onMouseLeave);

    // Push a history entry so we can detect back button
    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", onPopState);

    return () => {
      document.removeEventListener("mouseleave", onMouseLeave);
      window.removeEventListener("popstate", onPopState);
    };
  }, [trigger]);

  // Lock scroll when open
  useEffect(() => {
    if (!show) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = original;
      document.removeEventListener("keydown", onKey);
    };
  }, [show, dismiss]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-[rgba(0,0,0,0.6)] backdrop-blur-sm"
        onClick={dismiss}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md animate-[slideUp_0.3s_ease-out]">
        <button
          type="button"
          onClick={dismiss}
          className="absolute -top-3 -right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-white text-[var(--muted)] shadow-lg hover:text-[var(--text)] transition-colors"
          aria-label="Close popup"
        >
          ×
        </button>
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--bg)] p-6 shadow-[0_24px_64px_rgba(15,27,45,0.25)]">
          <div className="mb-4 text-center">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Before you go
            </div>
            <div className="mt-2 text-2xl font-black text-[var(--text)]">
              Get 10% off your first order
            </div>
            <div className="mt-1 text-sm text-[var(--muted)]">
              Join 2,000+ families choosing dye-free gummies.
            </div>
          </div>
          <LeadCapture
            source="exit_intent"
            title=""
            subtitle=""
            ctaLabel="Get my 10% off"
            successMessage="Check your inbox for your discount code!"
            emphasis="quiet"
            showSms={false}
          />
          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={dismiss}
              className="text-[11px] font-semibold text-[var(--muted)] underline underline-offset-4 hover:text-[var(--text)] transition-colors"
            >
              No thanks, I&apos;ll pay full price
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
