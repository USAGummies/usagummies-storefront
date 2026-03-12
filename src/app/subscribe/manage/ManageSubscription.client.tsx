"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  SUBSCRIPTION_FREQUENCIES,
  subscriptionPricingForQty,
} from "@/lib/bundles/pricing";

const QTY_OPTIONS = [5, 8, 12] as const;

type Subscription = {
  email: string;
  name: string;
  quantity: number;
  frequency: string;
  frequencyDays: number;
  perBag: number;
  total: number;
  savings: number;
  status: "active" | "paused" | "cancelled";
  createdAt: string;
  nextDeliveryDate: string;
  pausedAt: string | null;
  cancelledAt: string | null;
};

export function ManageSubscription() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Editing state
  const [editQty, setEditQty] = useState<number>(5);
  const [editFreqIdx, setEditFreqIdx] = useState(0);
  const [editing, setEditing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const lookupSubscription = useCallback(async (lookupEmail: string, lookupToken: string) => {
    setLoading(true);
    setErrorMsg("");
    setSub(null);

    try {
      const res = await fetch(
        `/api/subscriptions/manage?email=${encodeURIComponent(lookupEmail)}&token=${encodeURIComponent(lookupToken)}`,
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "Subscription not found.");
        setLoading(false);
        return;
      }
      const s = data.subscription as Subscription;
      setSub(s);
      setEditQty(s.quantity);
      const freqIdx = SUBSCRIPTION_FREQUENCIES.findIndex((f) => f.label === s.frequency);
      setEditFreqIdx(freqIdx >= 0 ? freqIdx : 0);
    } catch {
      setErrorMsg("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Read email/token from URL params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const e = params.get("email") || "";
    const t = params.get("token") || "";
    if (e) setEmail(e);
    if (t) setToken(t);
    if (e && t) {
      lookupSubscription(e, t);
    }
  }, [lookupSubscription]);

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !token.trim()) {
      setErrorMsg("Please enter your email and management token (from your confirmation email).");
      return;
    }
    lookupSubscription(email.trim(), token.trim());
  };

  const performAction = async (action: string, extra?: Record<string, unknown>) => {
    setActionLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/subscriptions/manage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token, action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "Action failed.");
        setActionLoading(false);
        return;
      }
      setSub(data.subscription);
      setEditing(false);

      const msgs: Record<string, string> = {
        pause: "Subscription paused. Resume anytime.",
        resume: "Subscription resumed!",
        cancel: "Subscription cancelled.",
        update: "Subscription updated!",
      };
      setSuccessMsg(msgs[action] || "Done!");
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch {
      setErrorMsg("Network error. Please try again.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdate = () => {
    const freq = SUBSCRIPTION_FREQUENCIES[editFreqIdx];
    performAction("update", { quantity: editQty, frequency: freq.label });
  };

  // Lookup form
  if (!sub) {
    return (
      <div>
        <form onSubmit={handleLookup} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            required
            className="w-full rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[#2D7A3A]/30"
          />
          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Management token (from confirmation email)"
            required
            className="w-full rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[#2D7A3A]/30"
          />
          {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}
          <button
            type="submit"
            disabled={loading}
            className="btn btn-candy pressable w-full py-3 text-sm font-bold disabled:opacity-60"
          >
            {loading ? "Looking up\u2026" : "Find my subscription"}
          </button>
        </form>
        <p className="mt-3 text-center text-[10px] text-[var(--muted)]">
          Can&rsquo;t find your token? Check your subscription confirmation email from USA Gummies.
        </p>
      </div>
    );
  }

  // Subscription detail view
  const statusColors: Record<string, string> = {
    active: "bg-[#2D7A3A]/10 text-[#2D7A3A]",
    paused: "bg-amber-100 text-amber-700",
    cancelled: "bg-red-100 text-red-700",
  };

  return (
    <div className="space-y-5">
      {successMsg && (
        <div className="rounded-xl border border-[#2D7A3A]/30 bg-[#2D7A3A]/5 px-4 py-3 text-sm font-semibold text-[#2D7A3A]">
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {errorMsg}
        </div>
      )}

      {/* Status */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-[var(--muted)]">Status</div>
          <span className={`mt-1 inline-block rounded-full px-3 py-1 text-xs font-bold capitalize ${statusColors[sub.status] || ""}`}>
            {sub.status}
          </span>
        </div>
        <div className="text-right">
          <div className="text-xs text-[var(--muted)]">Subscriber since</div>
          <div className="text-sm font-semibold text-[var(--text)]">
            {new Date(sub.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </div>
        </div>
      </div>

      {/* Current details */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-[var(--muted)]">Quantity</span>
          <span className="font-bold text-[var(--text)]">{sub.quantity} bags</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-[var(--muted)]">Price</span>
          <span className="font-bold text-[var(--text)]">${sub.perBag.toFixed(2)}/bag (${sub.total.toFixed(2)} total)</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-[var(--muted)]">Frequency</span>
          <span className="font-bold text-[var(--text)]">{sub.frequency}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-[var(--muted)]">Shipping</span>
          <span className="font-semibold text-[#2D7A3A]">FREE</span>
        </div>
        {sub.status !== "cancelled" && (
          <div className="flex justify-between text-sm border-t border-[var(--border)] pt-2">
            <span className="text-[var(--muted)]">
              {sub.status === "paused" ? "Delivery paused" : "Next delivery"}
            </span>
            <span className="font-bold text-[var(--text)]">
              {sub.status === "paused"
                ? "Paused"
                : new Date(sub.nextDeliveryDate).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
            </span>
          </div>
        )}
        <div className="text-xs font-semibold text-[#2D7A3A]">
          Saving ${sub.savings.toFixed(2)} per delivery vs bundles
        </div>
      </div>

      {/* Edit mode */}
      {editing && sub.status !== "cancelled" && (
        <div className="rounded-2xl border-2 border-[#2D7A3A]/30 bg-[#2D7A3A]/5 p-4 space-y-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Edit subscription
          </div>

          <div>
            <div className="text-xs text-[var(--muted)] mb-2">Quantity</div>
            <div className="flex gap-2">
              {QTY_OPTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setEditQty(q)}
                  className={`flex-1 rounded-xl border-2 px-3 py-2 text-sm font-bold transition ${
                    editQty === q
                      ? "border-[#2D7A3A] bg-white text-[#2D7A3A]"
                      : "border-[var(--border)] bg-[var(--surface-strong)] text-[var(--text)]"
                  }`}
                >
                  {q} bags
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs text-[var(--muted)] mb-2">Frequency</div>
            <div className="flex gap-2">
              {SUBSCRIPTION_FREQUENCIES.map((f, idx) => (
                <button
                  key={f.label}
                  type="button"
                  onClick={() => setEditFreqIdx(idx)}
                  className={`flex-1 rounded-xl border-2 px-2 py-2 text-xs font-bold transition ${
                    editFreqIdx === idx
                      ? "border-[#2D7A3A] bg-white text-[#2D7A3A]"
                      : "border-[var(--border)] bg-[var(--surface-strong)] text-[var(--text)]"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Preview pricing */}
          {(editQty !== sub.quantity || SUBSCRIPTION_FREQUENCIES[editFreqIdx].label !== sub.frequency) && (
            <div className="text-xs text-[var(--muted)]">
              New price: <strong className="text-[var(--text)]">${subscriptionPricingForQty(editQty).total.toFixed(2)}</strong> per delivery
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleUpdate}
              disabled={actionLoading}
              className="btn btn-candy pressable flex-1 py-2.5 text-sm font-bold disabled:opacity-60"
            >
              {actionLoading ? "Saving\u2026" : "Save changes"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="btn btn-outline pressable px-4 py-2.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {sub.status !== "cancelled" && (
        <div className="space-y-2">
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="btn btn-candy pressable w-full py-3 text-sm font-bold"
            >
              Edit quantity or frequency
            </button>
          )}

          {sub.status === "active" && (
            <button
              onClick={() => performAction("pause")}
              disabled={actionLoading}
              className="btn btn-outline pressable w-full py-3 text-sm font-bold disabled:opacity-60"
            >
              {actionLoading ? "Processing\u2026" : "Pause subscription"}
            </button>
          )}

          {sub.status === "paused" && (
            <button
              onClick={() => performAction("resume")}
              disabled={actionLoading}
              className="btn btn-candy pressable w-full py-3 text-sm font-bold disabled:opacity-60"
            >
              {actionLoading ? "Processing\u2026" : "Resume subscription"}
            </button>
          )}

          <button
            onClick={() => {
              if (window.confirm("Are you sure you want to cancel your subscription? You can always subscribe again later.")) {
                performAction("cancel");
              }
            }}
            disabled={actionLoading}
            className="w-full py-2 text-xs text-red-500 underline underline-offset-4 hover:text-red-700 disabled:opacity-60"
          >
            Cancel subscription
          </button>
        </div>
      )}

      {sub.status === "cancelled" && (
        <div className="text-center space-y-3">
          <p className="text-sm text-[var(--muted)]">
            Your subscription was cancelled on{" "}
            {sub.cancelledAt
              ? new Date(sub.cancelledAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
              : "N/A"}.
          </p>
          <Link href="/subscribe" className="btn btn-candy pressable inline-block px-6 py-3 text-sm font-bold">
            Start a new subscription
          </Link>
        </div>
      )}
    </div>
  );
}
