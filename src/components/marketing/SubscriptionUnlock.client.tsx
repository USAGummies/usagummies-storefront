"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { trackEvent } from "@/lib/analytics";
import {
  applyPurchaseUnlockFromUrl,
  getPurchaseUnlocked,
  setPurchaseUnlocked,
} from "@/lib/subscriptionUnlock";

type SubscriptionUnlockProps = {
  source: string;
  variant?: "light" | "dark";
  unlockOnMount?: boolean;
};

export function SubscriptionUnlock({
  source,
  variant = "light",
  unlockOnMount = false,
}: SubscriptionUnlockProps) {
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    const wasUnlocked = getPurchaseUnlocked();
    const unlockedFromUrl = applyPurchaseUnlockFromUrl();
    let hasPurchase = getPurchaseUnlocked();

    if (unlockOnMount && !hasPurchase) {
      setPurchaseUnlocked(true);
      hasPurchase = true;
    }

    if (!wasUnlocked && (unlockedFromUrl || unlockOnMount)) {
      trackEvent("subscription_unlock", { source });
    }

    setUnlocked(hasPurchase);
  }, [unlockOnMount, source]);

  if (!unlocked) {
    return (
      <div
        className={cn(
          "rounded-2xl p-3 shadow-none",
          variant === "dark"
            ? "metal-panel border border-white/12 text-white"
            : "card-solid border border-[rgba(15,27,45,0.12)] text-[var(--text)]"
        )}
      >
        <div
          className={cn(
            "text-[13px] font-black",
            variant === "dark" ? "text-white" : "text-[var(--text)]"
          )}
        >
          Subscription access
        </div>
        <div
          className={cn(
            "mt-1 text-[11px]",
            variant === "dark" ? "text-white/65" : "text-[var(--muted)]"
          )}
        >
          Subscriptions unlock after your first order. Premium access only.
        </div>
        <div
          className={cn(
            "mt-2 inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold",
            variant === "dark" ? "border-white/20 text-white/70" : "border-[var(--border)] text-[var(--muted)]"
          )}
        >
          Unlocks after purchase
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-2xl p-3 shadow-none",
        variant === "dark"
          ? "metal-panel border border-white/12 text-white"
          : "card-solid border border-[rgba(15,27,45,0.12)] text-[var(--text)]"
      )}
    >
      <div
        className={cn(
          "text-[13px] font-black",
          variant === "dark" ? "text-white" : "text-[var(--text)]"
        )}
      >
        Subscription eligible
      </div>
      <div
        className={cn(
          "mt-1 text-[11px]",
          variant === "dark" ? "text-white/65" : "text-[var(--muted)]"
        )}
      >
        You joined the Revolution. Subscription access is now unlocked, and your invite will arrive by email.
      </div>
      <div
        className={cn(
          "mt-2 inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold",
          variant === "dark" ? "border-white/20 text-white/70" : "border-[var(--border)] text-[var(--muted)]"
        )}
      >
        Eligible now
      </div>
    </div>
  );
}
