"use client";

import React, { useState, useMemo } from "react";
import {
  SUBSCRIPTION_FREQUENCIES,
  subscriptionPricingForQty,
  perBagForQty,
  totalForQty,
} from "@/lib/bundles/pricing";

const QTY_OPTIONS = [5, 8, 12] as const;

export function SubscribeForm() {
  const [qty, setQty] = useState<number>(5);
  const [frequencyIdx, setFrequencyIdx] = useState(0);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const frequency = SUBSCRIPTION_FREQUENCIES[frequencyIdx];

  const pricing = useMemo(() => {
    const sub = subscriptionPricingForQty(qty);
    const bundlePerBag = perBagForQty(qty);
    const bundleTotal = totalForQty(qty);
    return { ...sub, bundlePerBag, bundleTotal };
  }, [qty]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !name.trim() || submitting) return;

    setSubmitting(true);
    setErrorMsg("");

    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim(),
          quantity: qty,
          frequency: frequency.label,
          frequencyDays: frequency.days,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }

      // Fire GA4 event before redirect
      if (typeof window !== "undefined" && (window as any).gtag) {
        (window as any).gtag("event", "subscription_signup", {
          event_category: "conversion",
          event_label: `${qty}_bags_${frequency.label}`,
          value: pricing.total,
        });
      }

      // Redirect to Shopify checkout if we got a checkoutUrl
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }

      // Fallback: show success if no checkout URL (shouldn't happen)
      setSubmitted(true);
    } catch {
      setErrorMsg("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="rounded-2xl border border-[#2D7A3A]/30 bg-[#2D7A3A]/5 p-6 text-center">
        <div className="text-3xl mb-2">&#127881;</div>
        <h3 className="text-xl font-black text-[var(--text)]">
          You&rsquo;re subscribed!
        </h3>
        <p className="mt-2 text-sm text-[var(--muted)]">
          We&rsquo;ll send a confirmation to <strong>{email}</strong> with your subscription details.
          Your first delivery of <strong>{qty} bags</strong> will ship soon.
        </p>
        <p className="mt-3 text-xs text-[var(--muted)]">
          You can manage your subscription anytime from your{" "}
          <a href="/subscribe/manage" className="underline underline-offset-4 font-semibold text-[var(--text)]">
            subscription dashboard
          </a>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quantity selector */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
          Step 1 &mdash; Choose your quantity
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {QTY_OPTIONS.map((q) => {
            const sub = subscriptionPricingForQty(q);
            const bundlePerBag = perBagForQty(q);
            const isSelected = qty === q;
            return (
              <button
                key={q}
                type="button"
                onClick={() => setQty(q)}
                className={`relative rounded-2xl border-2 p-4 text-left transition ${
                  isSelected
                    ? "border-[#2D7A3A] bg-[#2D7A3A]/5 shadow-sm"
                    : "border-[var(--border)] bg-[var(--surface-strong)] hover:border-[#2D7A3A]/40"
                }`}
              >
                {q === 5 && (
                  <span className="absolute -top-2.5 right-3 rounded-full bg-[#2D7A3A] px-2.5 py-0.5 text-[10px] font-bold text-white">
                    Most Popular
                  </span>
                )}
                <div className="text-2xl font-black text-[var(--text)]">{q} bags</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-lg font-bold text-[#2D7A3A]">
                    ${sub.perBag.toFixed(2)}/bag
                  </span>
                  <span className="text-xs text-[var(--muted)] line-through">
                    ${bundlePerBag.toFixed(2)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  ${sub.total.toFixed(2)} per delivery
                </div>
                <div className="mt-1 text-xs font-semibold text-[#2D7A3A]">
                  Save ${sub.savings.toFixed(2)} vs bundles
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Frequency selector */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
          Step 2 &mdash; Pick your frequency
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {SUBSCRIPTION_FREQUENCIES.map((freq, idx) => {
            const isSelected = frequencyIdx === idx;
            return (
              <button
                key={freq.label}
                type="button"
                onClick={() => setFrequencyIdx(idx)}
                className={`rounded-2xl border-2 p-4 text-left transition ${
                  isSelected
                    ? "border-[#2D7A3A] bg-[#2D7A3A]/5 shadow-sm"
                    : "border-[var(--border)] bg-[var(--surface-strong)] hover:border-[#2D7A3A]/40"
                }`}
              >
                <div className="text-sm font-bold text-[var(--text)]">{freq.label}</div>
                <div className="mt-0.5 text-xs text-[var(--muted)]">
                  Every {freq.days} days
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pricing summary */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
          Your subscription summary
        </div>
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--muted)]">{qty} bags &times; ${pricing.perBag.toFixed(2)}/bag</span>
            <span className="font-bold text-[var(--text)]">${pricing.total.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--muted)]">Shipping</span>
            <span className="font-semibold text-[#2D7A3A]">FREE</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--muted)]">Frequency</span>
            <span className="font-semibold text-[var(--text)]">{frequency.label}</span>
          </div>
          <div className="border-t border-[var(--border)] pt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-[var(--text)]">Per delivery</span>
              <span className="text-lg font-black text-[var(--text)]">${pricing.total.toFixed(2)}</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-[#2D7A3A]">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1Zm3.03 4.97a.75.75 0 0 0-1.06 0L7 8.94 5.53 7.47a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5a.75.75 0 0 0 0-1.06Z" />
              </svg>
              You save ${pricing.savings.toFixed(2)} per delivery vs bundles
            </div>
          </div>
        </div>
      </div>

      {/* Signup form */}
      <form onSubmit={handleSubmit}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
          Step 3 &mdash; Start your subscription
        </div>
        <div className="mt-3 space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            required
            className="w-full rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[#2D7A3A]/30"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            required
            className="w-full rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[#2D7A3A]/30"
          />
          {errorMsg && (
            <p className="text-xs text-red-600">{errorMsg}</p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="btn btn-candy pressable w-full py-3.5 text-base font-bold disabled:opacity-60"
          >
            {submitting
              ? "Preparing checkout\u2026"
              : `Subscribe & checkout \u2014 $${pricing.total.toFixed(2)}/${frequency.label.toLowerCase()}`}
          </button>
        </div>
        <p className="mt-3 text-center text-[10px] text-[var(--muted)]">
          Cancel or pause anytime. Free shipping on every delivery. You&rsquo;ll receive a checkout link before each order.
        </p>
      </form>
    </div>
  );
}
