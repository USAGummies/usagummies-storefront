"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { trackEvent } from "@/lib/analytics";

type Status = "idle" | "loading" | "success" | "error";

export function WholesaleInquiryForm({ className }: { className?: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "loading") return;

    const form = event.currentTarget;
    const data = new FormData(form);

    const storeName = String(data.get("storeName") || "").trim();
    const buyerName = String(data.get("buyerName") || "").trim();
    const email = String(data.get("email") || "").trim();
    const phone = String(data.get("phone") || "").trim();
    const location = String(data.get("location") || "").trim();
    const interest = String(data.get("interest") || "starter-case").trim();

    if (!storeName || !buyerName || !email || !phone || !location) {
      setStatus("error");
      setError("Please complete all fields to submit your wholesale request.");
      return;
    }

    setError(null);
    setStatus("loading");
    trackEvent("wholesale_inquiry_submit", {
      interest,
      hasEmail: Boolean(email),
      hasPhone: Boolean(phone),
    });

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "wholesale",
          intent: "wholesale",
          storeName,
          buyerName,
          email,
          phone,
          location,
          interest,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || "Could not submit.");
      }
      setStatus("success");
      form.reset();
    } catch (err: any) {
      setStatus("error");
      setError(err?.message || "Something went wrong. Please try again.");
    }
  }

  return (
    <div
      className={cn(
        "rounded-3xl border border-[var(--border)] bg-white/90 p-5 shadow-[0_18px_44px_rgba(15,27,45,0.12)]",
        className
      )}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
        Wholesale inquiry
      </div>
      <div className="mt-2 text-xl font-black text-[var(--text)]">
        Start a wholesale partnership
      </div>
      <div className="mt-1 text-sm text-[var(--muted)]">
        Fill out the short form and we will respond within 1–2 business days.
      </div>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-3">
        <input
          name="storeName"
          placeholder="Store name"
          required
          className="usa-input"
          aria-label="Store name"
        />
        <input
          name="buyerName"
          placeholder="Buyer name"
          required
          className="usa-input"
          aria-label="Buyer name"
        />
        <input
          type="email"
          name="email"
          placeholder="Email"
          required
          className="usa-input"
          aria-label="Email"
        />
        <input
          type="tel"
          name="phone"
          placeholder="Phone"
          required
          className="usa-input"
          aria-label="Phone"
        />
        <input
          name="location"
          placeholder="City / State"
          required
          className="usa-input"
          aria-label="City and state"
        />

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="submit"
            name="interest"
            value="starter-case"
            className={cn(
              "btn btn-candy pressable",
              status === "loading" && "opacity-70 pointer-events-none"
            )}
          >
            {status === "loading" ? "Sending..." : "Request starter case"}
          </button>
          <button
            type="submit"
            name="interest"
            value="samples"
            className={cn(
              "btn btn-outline pressable",
              status === "loading" && "opacity-70 pointer-events-none"
            )}
          >
            Request samples
          </button>
        </div>
      </form>

      {status === "success" ? (
        <div className="mt-3 text-sm font-semibold text-[rgba(21,128,61,0.95)]">
          Thanks — we received your wholesale request.
        </div>
      ) : null}
      {status === "error" && error ? (
        <div className="mt-3 text-sm text-[var(--red)]">{error}</div>
      ) : null}

      <div className="mt-3 text-[11px] text-[var(--muted)]">
        By submitting, you agree to our{" "}
        <Link
          href="/policies/privacy"
          className="text-[var(--text)] underline underline-offset-4"
        >
          Privacy Policy
        </Link>
        .
      </div>
    </div>
  );
}
