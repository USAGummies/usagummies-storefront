"use client";

import React, { useState } from "react";

export function RewardsWaitlist() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || submitting) return;

    setSubmitting(true);
    setErrorMsg("");

    if (typeof window !== "undefined" && (window as any).gtag) {
      (window as any).gtag("event", "rewards_waitlist_signup", {
        event_category: "engagement",
        event_label: "rewards_waitlist",
      });
    }

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          source: "rewards-waitlist",
          intent: "rewards-waitlist",
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }

      setSubmitted(true);
    } catch {
      setErrorMsg("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="rounded-2xl border border-[#C9A44A]/30 bg-[#C9A44A]/5 p-6 text-center">
        <h3 className="text-xl font-black text-[var(--text)]">
          You&rsquo;re on the list!
        </h3>
        <p className="mt-2 text-sm text-[var(--muted)]">
          We&rsquo;ll email <strong>{email}</strong> as soon as the rewards program launches.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#C9A44A]">
          Be the first to know
        </div>
        <h2 className="mt-2 text-xl font-black text-[var(--text)]">
          Join the rewards waitlist
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Get notified the moment our rewards program goes live.
          Early members will receive bonus points to get started.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="rounded-2xl border border-[var(--border)] bg-white p-4">
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            required
            className="flex-1 rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[#C9A44A]/30"
          />
          <button
            type="submit"
            disabled={submitting}
            className="btn btn-candy pressable whitespace-nowrap px-5 py-3 text-sm font-bold disabled:opacity-60"
          >
            {submitting ? "Joining\u2026" : "Join waitlist"}
          </button>
        </div>
        {errorMsg && (
          <p className="mt-2 text-xs text-red-600">{errorMsg}</p>
        )}
      </form>

      <p className="text-center text-[10px] text-[var(--muted)]">
        No spam. Just a single email when we launch.
      </p>
    </div>
  );
}
