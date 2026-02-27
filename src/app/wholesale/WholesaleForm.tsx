"use client";

import { useState } from "react";

type FormState = "idle" | "submitting" | "success" | "error";

export function WholesaleForm() {
  const [state, setState] = useState<FormState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("submitting");
    setErrorMsg("");

    const fd = new FormData(e.currentTarget);
    const payload = {
      email: fd.get("email"),
      buyerName: fd.get("buyerName"),
      storeName: fd.get("storeName"),
      location: fd.get("location"),
      interest: fd.get("interest"),
      source: "wholesale-page",
      intent: "wholesale",
    };

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Something went wrong.");
      }
      setState("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
      setState("error");
    }
  }

  if (state === "success") {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-5 text-center space-y-2">
        <div className="text-2xl">🎉</div>
        <div className="text-sm font-black text-[var(--text)]">Request received!</div>
        <p className="text-xs text-[var(--muted)]">
          We&rsquo;ll send wholesale pricing to your inbox within 24 hours.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4 space-y-3">
      <div className="text-sm font-black text-[var(--text)]">Get wholesale pricing</div>
      <p className="text-xs text-[var(--muted)]">
        For distributors, retailers, and businesses ordering in bulk.
      </p>

      <input
        name="buyerName"
        type="text"
        required
        placeholder="Your name"
        className="w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)] outline-none focus:ring-2 focus:ring-[var(--navy)]/20"
      />
      <input
        name="email"
        type="email"
        required
        placeholder="Email address"
        className="w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)] outline-none focus:ring-2 focus:ring-[var(--navy)]/20"
      />
      <input
        name="storeName"
        type="text"
        placeholder="Business / store name"
        className="w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)] outline-none focus:ring-2 focus:ring-[var(--navy)]/20"
      />
      <input
        name="location"
        type="text"
        placeholder="City, State (optional)"
        className="w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)] outline-none focus:ring-2 focus:ring-[var(--navy)]/20"
      />
      <select
        name="interest"
        className="w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-2 focus:ring-[var(--navy)]/20"
        defaultValue=""
      >
        <option value="" disabled>What are you looking for?</option>
        <option value="starter-case">Starter case (sample order)</option>
        <option value="bulk-pricing">Bulk wholesale pricing</option>
        <option value="distribution">Distribution partnership</option>
        <option value="custom-private-label">Custom / private label</option>
        <option value="event-gifting">Event or corporate gifting</option>
      </select>

      {state === "error" && (
        <p className="text-xs text-red-600">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={state === "submitting"}
        className="btn btn-candy pressable w-full disabled:opacity-60"
      >
        {state === "submitting" ? "Sending..." : "Request pricing"}
      </button>

      <p className="text-[10px] text-[var(--muted)] text-center">
        No spam. We&rsquo;ll reply with pricing, MOQs, and next steps.
      </p>
    </form>
  );
}
