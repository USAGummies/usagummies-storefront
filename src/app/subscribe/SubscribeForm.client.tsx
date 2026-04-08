"use client";

import React, { useState, useMemo } from "react";
import Image from "next/image";
import {
  SUBSCRIPTION_FREQUENCIES,
  subscriptionPricingForQty,
  totalForQty,
  BASE_PRICE,
} from "@/lib/bundles/pricing";
import { AMAZON_REVIEWS } from "@/data/amazonReviews";

const QTY_OPTIONS = [5, 8, 12] as const;

const SUBSCRIBE_PERKS = [
  { icon: "💰", text: "Save $0.50/bag vs bundles" },
  { icon: "🚚", text: "Free shipping every time" },
  { icon: "⏸️", text: "Pause or cancel anytime" },
  { icon: "📦", text: "Auto-delivered on your schedule" },
] as const;

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
    const bundleTotal = totalForQty(qty);
    return { ...sub, bundleTotal };
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
      {/* Why subscribe — value props */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        {SUBSCRIBE_PERKS.map((perk) => (
          <div key={perk.text} className="flex items-center gap-2 rounded-xl bg-[#2D7A3A]/5 px-3 py-2.5">
            <span className="text-base">{perk.icon}</span>
            <span className="text-[11px] font-semibold text-[#2D7A3A]">{perk.text}</span>
          </div>
        ))}
      </div>

      {/* Quantity selector */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
          Step 1 &mdash; Choose your quantity
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {QTY_OPTIONS.map((q) => {
            const sub = subscriptionPricingForQty(q);
            const retailTotal = (BASE_PRICE * q).toFixed(2);
            const isSelected = qty === q;
            const badge = q === 5 ? "Most Popular" : q === 12 ? "Best Value" : null;
            return (
              <button
                key={q}
                type="button"
                onClick={() => setQty(q)}
                className={`relative rounded-2xl border-2 p-4 text-left transition ${
                  isSelected
                    ? "border-[#2D7A3A] bg-[#2D7A3A]/5 shadow-md ring-1 ring-[#2D7A3A]/20"
                    : "border-[var(--border)] bg-[var(--surface-strong)] hover:border-[#2D7A3A]/40 hover:shadow-sm"
                }`}
              >
                {badge && (
                  <span className={`absolute -top-2.5 right-3 rounded-full px-2.5 py-0.5 text-[10px] font-bold text-white ${q === 12 ? "bg-[#c7362c]" : "bg-[#2D7A3A]"}`}>
                    {badge}
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <div className="relative h-10 w-10 flex-shrink-0">
                    <Image
                      src="/brand/americana/bag-dramatic-smoke.jpg"
                      alt="USA Gummies bag"
                      fill
                      sizes="40px"
                      className="rounded-lg object-cover"
                    />
                  </div>
                  <div className="text-2xl font-black text-[var(--text)]">{q} bags</div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-lg font-bold text-[#2D7A3A]">
                    ${sub.perBag.toFixed(2)}/bag
                  </span>
                  <span className="text-xs text-[var(--muted)] line-through">
                    ${BASE_PRICE.toFixed(2)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  ${sub.total.toFixed(2)} per delivery
                  <span className="ml-1 text-[var(--muted)] line-through text-[10px]">${retailTotal}</span>
                </div>
                <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#2D7A3A]">
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden="true">
                    <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1Zm3.03 4.97a.75.75 0 0 0-1.06 0L7 8.94 5.53 7.47a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5a.75.75 0 0 0 0-1.06Z" />
                  </svg>
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
        <p className="mt-1 text-xs text-[var(--muted)]">How often should we deliver? Change anytime.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {SUBSCRIPTION_FREQUENCIES.map((freq, idx) => {
            const isSelected = frequencyIdx === idx;
            const descriptions = [
              "Great for daily snackers",
              "Most popular frequency",
              "Perfect for occasional treats",
            ];
            return (
              <button
                key={freq.label}
                type="button"
                onClick={() => setFrequencyIdx(idx)}
                className={`rounded-2xl border-2 p-4 text-left transition ${
                  isSelected
                    ? "border-[#2D7A3A] bg-[#2D7A3A]/5 shadow-md ring-1 ring-[#2D7A3A]/20"
                    : "border-[var(--border)] bg-[var(--surface-strong)] hover:border-[#2D7A3A]/40 hover:shadow-sm"
                }`}
              >
                {idx === 1 && (
                  <span className="inline-block mb-1.5 rounded-full bg-[#2D7A3A] px-2 py-0.5 text-[9px] font-bold text-white uppercase tracking-wider">
                    Recommended
                  </span>
                )}
                <div className="text-sm font-bold text-[var(--text)]">{freq.label}</div>
                <div className="mt-0.5 text-xs text-[var(--muted)]">
                  Every {freq.days} days
                </div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">{descriptions[idx]}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pricing summary with product visual */}
      <div className="rounded-2xl border-2 border-[#2D7A3A]/20 bg-gradient-to-br from-[#2D7A3A]/[0.03] to-transparent p-4 sm:p-5">
        <div className="flex gap-4 sm:gap-5">
          {/* Product image */}
          <div className="hidden sm:block relative h-32 w-24 flex-shrink-0 overflow-hidden rounded-xl border border-[var(--border)]">
            <Image
              src="/brand/gallery/bag-navy-hero.jpg"
              alt="USA Gummies bag"
              fill
              sizes="96px"
              className="object-cover"
            />
          </div>
          {/* Pricing details */}
          <div className="flex-1 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#2D7A3A]">
              Your subscription summary
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--muted)]">{qty} bags &times; ${pricing.perBag.toFixed(2)}/bag</span>
              <span className="font-bold text-[var(--text)]">${pricing.total.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--muted)]">Retail value ({qty} &times; ${BASE_PRICE.toFixed(2)})</span>
              <span className="font-semibold text-[var(--muted)] line-through">${(BASE_PRICE * qty).toFixed(2)}</span>
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
                <span className="text-sm font-bold text-[var(--text)]">You pay per delivery</span>
                <div className="text-right">
                  <span className="text-xl font-black text-[var(--text)]">${pricing.total.toFixed(2)}</span>
                </div>
              </div>
              <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-[#2D7A3A]/10 px-2.5 py-1 text-xs font-bold text-[#2D7A3A]">
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                  <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1Zm3.03 4.97a.75.75 0 0 0-1.06 0L7 8.94 5.53 7.47a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5a.75.75 0 0 0 0-1.06Z" />
                </svg>
                You save ${((BASE_PRICE * qty) - pricing.total).toFixed(2)} per delivery
              </div>
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
            className="btn btn-candy pressable w-full py-4 text-base font-bold disabled:opacity-60 shadow-lg shadow-[#c7362c]/20"
          >
            {submitting
              ? "Preparing checkout\u2026"
              : `Subscribe & checkout \u2014 $${pricing.total.toFixed(2)}/${frequency.label.toLowerCase()}`}
          </button>
        </div>

        {/* Guarantee + social proof near CTA */}
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-center gap-2 text-xs text-[var(--muted)]">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#2D7A3A]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 10V8a6 6 0 1 1 12 0v2h1v12H5V10h1zm2 0h8V8a4 4 0 1 0-8 0v2z" />
            </svg>
            <span>Secure checkout powered by Shopify</span>
          </div>
          <div className="flex items-center justify-center gap-3">
            <div className="flex items-center gap-1">
              <span className="flex text-[#f5c842]">{"★★★★★".split("").map((s, i) => <span key={i} className="text-xs">{s}</span>)}</span>
              <span className="text-xs font-bold text-[var(--text)]">{AMAZON_REVIEWS.aggregate.rating.toFixed(1)}</span>
            </div>
            <span className="text-[10px] text-[var(--muted)]">{AMAZON_REVIEWS.aggregate.count.toLocaleString()}+ verified reviews on Amazon</span>
          </div>
          <p className="text-center text-[10px] text-[var(--muted)]">
            Cancel or pause anytime. Free shipping on every delivery. 30-day money-back guarantee.
          </p>
        </div>
      </form>
    </div>
  );
}
