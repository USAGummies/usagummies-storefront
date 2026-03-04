"use client";

import React, { useState } from "react";
import { REDEMPTION_TIERS, REFERRAL_BONUS } from "@/lib/loyalty";

interface TierInfo {
  points: number;
  reward: string;
  bags: number;
}

interface NextTier {
  tier: TierInfo;
  pointsNeeded: number;
  progress: number;
}

interface Transaction {
  id: string;
  type: "earn" | "redeem" | "bonus";
  points: number;
  description: string;
  createdAt: string;
}

interface AccountData {
  email: string;
  name: string;
  balance: number;
  totalEarned: number;
  totalRedeemed: number;
  referralCode: string;
  availableRewards: TierInfo[];
  nextTier: NextTier | null;
  recentTransactions: Transaction[];
  memberSince: string;
}

export function RewardsView() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [mode, setMode] = useState<"lookup" | "enroll">("lookup");
  const [redeeming, setRedeeming] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const lookupAccount = async () => {
    if (!email.trim()) return;
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch(`/api/loyalty?email=${encodeURIComponent(email.trim())}`);
      const data = await res.json();
      if (data.ok) {
        setAccount(data);
      } else if (res.status === 404) {
        setError("No rewards account found. Would you like to enroll?");
        setMode("enroll");
      } else {
        setError(data.error || "Something went wrong.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const enrollAccount = async () => {
    if (!email.trim() || !name.trim()) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/loyalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enroll", email: email.trim(), name: name.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setSuccess("You're enrolled! Start shopping to earn points.");
        // Refetch full account data
        await lookupAccount();
      } else {
        setError(data.error || "Could not enroll. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRedeem = async (tierPoints: number) => {
    if (!account) return;
    setRedeeming(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/loyalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "redeem", email: account.email, tier: tierPoints }),
      });
      const data = await res.json();
      if (data.ok) {
        setSuccess(`Redeemed! ${data.reward} will be added to your next order.`);
        // Refresh account
        await lookupAccount();
      } else {
        setError(data.error || "Could not redeem. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setRedeeming(false);
    }
  };

  const copyReferralCode = () => {
    if (!account?.referralCode) return;
    navigator.clipboard.writeText(account.referralCode).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    });
  };

  // --- Not logged in ---
  if (!account) {
    return (
      <div className="space-y-4">
        <div className="text-center">
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
            Your rewards
          </div>
          <h2 className="mt-2 text-xl font-black text-[var(--text)]">
            Check your points balance
          </h2>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
          <div className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              className="w-full rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[#C9A44A]/30"
              onKeyDown={(e) => e.key === "Enter" && lookupAccount()}
            />

            {mode === "enroll" && (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                className="w-full rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[#C9A44A]/30"
              />
            )}

            {error && <p className="text-xs text-red-600">{error}</p>}
            {success && <p className="text-xs text-[#2D7A3A] font-semibold">{success}</p>}

            <div className="flex gap-2">
              {mode === "lookup" ? (
                <button
                  onClick={lookupAccount}
                  disabled={loading}
                  className="btn btn-candy pressable w-full py-3 text-sm font-bold disabled:opacity-60"
                >
                  {loading ? "Looking up\u2026" : "Look up my points"}
                </button>
              ) : (
                <>
                  <button
                    onClick={enrollAccount}
                    disabled={loading || !name.trim()}
                    className="btn btn-candy pressable flex-1 py-3 text-sm font-bold disabled:opacity-60"
                  >
                    {loading ? "Enrolling\u2026" : "Enroll now"}
                  </button>
                  <button
                    onClick={() => { setMode("lookup"); setError(""); }}
                    className="rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--muted)] transition hover:bg-[var(--surface-strong)]"
                  >
                    Back
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        <p className="text-center text-[10px] text-[var(--muted)]">
          Points are automatically awarded after each order. Enter the email you use for orders.
        </p>
      </div>
    );
  }

  // --- Logged in view ---
  return (
    <div className="space-y-4">
      {/* Balance header */}
      <div className="rounded-2xl border border-[var(--border)] bg-white p-5 text-center">
        <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
          Your balance
        </div>
        <div className="mt-2 text-4xl font-black text-[#C9A44A]">{account.balance}</div>
        <div className="text-xs font-semibold uppercase tracking-widest text-[var(--muted)]">
          points
        </div>
        <div className="mt-2 text-xs text-[var(--muted)]">
          Member since {new Date(account.memberSince).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </div>

        {/* Next tier progress */}
        {account.nextTier && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-[var(--muted)]">
              <span>{account.balance} pts</span>
              <span>{account.nextTier.tier.points} pts — {account.nextTier.tier.reward}</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--surface-strong)]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#C9A44A] to-[#E8C45A] transition-all"
                style={{ width: `${Math.min(account.nextTier.progress * 100, 100)}%` }}
              />
            </div>
            <div className="mt-1 text-xs font-semibold text-[#C9A44A]">
              {account.nextTier.pointsNeeded} points to next reward
            </div>
          </div>
        )}
      </div>

      {success && (
        <div className="rounded-xl border border-[#2D7A3A]/30 bg-[#2D7A3A]/5 p-3 text-center text-xs font-semibold text-[#2D7A3A]">
          {success}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center text-xs text-red-600">
          {error}
        </div>
      )}

      {/* Available rewards */}
      {account.availableRewards.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
            Available to redeem
          </div>
          {account.availableRewards.map((reward) => (
            <div
              key={reward.points}
              className="flex items-center justify-between rounded-2xl border-2 border-[#C9A44A]/30 bg-[#C9A44A]/5 p-4"
            >
              <div>
                <div className="text-sm font-bold text-[var(--text)]">{reward.reward}</div>
                <div className="text-xs text-[var(--muted)]">{reward.points} points</div>
              </div>
              <button
                onClick={() => handleRedeem(reward.points)}
                disabled={redeeming}
                className="rounded-full bg-[#C9A44A] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#B8933A] disabled:opacity-60"
              >
                {redeeming ? "Redeeming\u2026" : "Redeem"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* All tiers */}
      {account.availableRewards.length === 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
            Reward tiers
          </div>
          {REDEMPTION_TIERS.map((tier) => (
            <div
              key={tier.points}
              className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-white p-4"
            >
              <div>
                <div className="text-sm font-bold text-[var(--text)]">{tier.reward}</div>
                <div className="text-xs text-[var(--muted)]">{tier.points} points needed</div>
              </div>
              <div className="text-xs font-semibold text-[var(--muted)]">
                {tier.points - account.balance} more pts
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Referral code */}
      <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
          Your referral code
        </div>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 rounded-lg bg-[var(--surface-strong)] px-3 py-2 text-sm font-bold tracking-wider text-[var(--text)]">
            {account.referralCode}
          </code>
          <button
            onClick={copyReferralCode}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--muted)] transition hover:bg-[var(--surface-strong)]"
          >
            {codeCopied ? "Copied!" : "Copy"}
          </button>
        </div>
        <div className="mt-2 text-xs text-[var(--muted)]">
          Share with friends. Earn {REFERRAL_BONUS} points when they place their first order.
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-[var(--border)] bg-white p-3 text-center">
          <div className="text-lg font-black text-[var(--text)]">{account.totalEarned}</div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">
            Total earned
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-white p-3 text-center">
          <div className="text-lg font-black text-[var(--text)]">{account.totalRedeemed}</div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">
            Total redeemed
          </div>
        </div>
      </div>

      {/* Recent transactions */}
      {account.recentTransactions.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
            Recent activity
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-white divide-y divide-[var(--border)]">
            {account.recentTransactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-xs font-semibold text-[var(--text)]">{tx.description}</div>
                  <div className="text-[10px] text-[var(--muted)]">
                    {new Date(tx.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </div>
                </div>
                <div
                  className={`text-sm font-bold ${
                    tx.points > 0 ? "text-[#2D7A3A]" : "text-red-600"
                  }`}
                >
                  {tx.points > 0 ? "+" : ""}{tx.points}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sign out */}
      <button
        onClick={() => {
          setAccount(null);
          setEmail("");
          setMode("lookup");
          setError("");
          setSuccess("");
        }}
        className="w-full text-center text-xs font-semibold text-[var(--muted)] underline underline-offset-4 transition hover:text-[var(--text)]"
      >
        Look up a different account
      </button>
    </div>
  );
}
