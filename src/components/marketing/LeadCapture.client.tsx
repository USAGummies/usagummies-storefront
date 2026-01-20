"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { trackEvent } from "@/lib/analytics";

type LeadCaptureProps = {
  source: string;
  intent?: "newsletter" | "subscription";
  title?: string;
  subtitle?: string;
  ctaLabel?: string;
  successMessage?: string;
  variant?: "light" | "dark";
  emphasis?: "default" | "quiet";
  showSms?: boolean;
};

export function LeadCapture({
  source,
  intent = "newsletter",
  title = "Join the revolution",
  subtitle = "Early drops, savings alerts, and patriotic releases.",
  ctaLabel = "Join the list",
  successMessage = "Thanks for joining. We will only send the good stuff.",
  variant = "light",
  emphasis = "default",
  showSms = true,
}: LeadCaptureProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [showSmsField, setShowSmsField] = useState(false);

  const isDark = variant === "dark";
  const isQuiet = emphasis === "quiet";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "loading") return;

    const form = e.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    const phone = String(data.get("phone") || "").trim();

    if (!email && !phone) {
      setError("Add an email or mobile number to continue.");
      setStatus("error");
      return;
    }

    setError(null);
    setStatus("loading");
    trackEvent("lead_capture_submit", { source, intent, hasEmail: Boolean(email), hasPhone: Boolean(phone) });

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, phone, source, intent }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || "Could not submit.");
      }
      setStatus("success");
      setShowSmsField(false);
      form.reset();
    } catch (err: any) {
      setStatus("error");
      setError(err?.message || "Something went wrong.");
    }
  }

  return (
    <div
      className={cn(
        "rounded-2xl",
        isQuiet ? "p-3 shadow-none hover:shadow-none hover:translate-y-0" : "p-4",
        isDark
          ? "metal-panel border border-white/12 text-white"
          : "card-solid border border-[var(--border)] text-[var(--text)]",
        isQuiet && !isDark ? "bg-[var(--surface-strong)]" : ""
      )}
    >
      <div
        className={cn(
          isQuiet ? "text-[13px] font-black" : "text-sm font-black",
          isDark ? "text-white" : "text-[var(--text)]"
        )}
      >
        {title}
      </div>
      <div
        className={cn(
          isQuiet ? "mt-1 text-[11px]" : "mt-1 text-xs",
          isDark ? "text-white/65" : "text-[var(--muted)]"
        )}
      >
        {subtitle}
      </div>

      <form onSubmit={handleSubmit} className={cn(isQuiet ? "mt-2 flex flex-wrap gap-2" : "mt-3 flex flex-wrap gap-2")}>
        <input type="hidden" name="source" value={source} />
        <input type="hidden" name="intent" value={intent} />
        <input
          type="email"
          name="email"
          placeholder="Email"
          className={cn(
            "flex-1 min-w-[200px] rounded-full px-4 py-2 text-sm",
            isDark
              ? "border border-white/15 bg-white/5 text-white placeholder-white/50"
              : "usa-input"
          )}
          aria-label="Email"
        />
        {showSms && showSmsField ? (
          <input
            type="tel"
            name="phone"
            placeholder="Mobile (optional)"
            className={cn(
              "flex-1 min-w-[180px] rounded-full px-4 py-2 text-sm",
              isDark
                ? "border border-white/15 bg-white/5 text-white placeholder-white/50"
                : "usa-input"
            )}
            aria-label="Mobile number"
          />
        ) : null}
        <button
          type="submit"
          className={cn(
            "btn pressable",
            isDark ? "btn-outline-white" : isQuiet ? "btn-outline" : "btn-candy",
            status === "loading" && "opacity-70 pointer-events-none"
          )}
        >
          {status === "loading" ? "Sending..." : ctaLabel}
        </button>
      </form>
      {showSms && !showSmsField ? (
        <button
          type="button"
          onClick={() => setShowSmsField(true)}
          className={cn(
            "mt-2 text-[10px] font-semibold uppercase tracking-[0.2em] underline underline-offset-4",
            isDark ? "text-white/70 hover:text-white" : "text-[var(--muted)] hover:text-[var(--text)]"
          )}
        >
          Add SMS alerts (optional)
        </button>
      ) : null}

      {status === "success" ? (
        <div className={cn("mt-2 text-xs", isDark ? "text-white/70" : "text-[var(--muted)]")}>
          {successMessage}
        </div>
      ) : null}
      {status === "error" && error ? (
        <div className="mt-2 text-xs text-[var(--red)]">{error}</div>
      ) : null}
      {showSms && showSmsField ? (
        <div className={cn("mt-2 text-[10px]", isDark ? "text-white/50" : "text-[var(--muted)]")}>
          SMS is optional. Standard message rates may apply.
        </div>
      ) : null}
      <div className={cn("mt-2 text-[10px]", isDark ? "text-white/55" : "text-[var(--muted)]")}>
        By joining, you agree to our{" "}
        <Link
          href="/policies/privacy"
          className={cn(
            "underline underline-offset-4",
            isDark ? "text-white/80 hover:text-white" : "text-[var(--text)]"
          )}
        >
          Privacy Policy
        </Link>
        .
      </div>
    </div>
  );
}
