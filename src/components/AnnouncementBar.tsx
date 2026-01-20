// src/components/AnnouncementBar.tsx
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function AnnouncementBar() {
  const searchParams = useSearchParams();
  const campaign = (searchParams.get("campaign") || "").toLowerCase();
  const isAmerica250 = campaign === "america250";

  const { left, right, href } = useMemo(() => {
    if (isAmerica250) {
      return {
        left: "America 250 limited drops",
        right: FREE_SHIPPING_PHRASE,
        href: "/shop?campaign=america250",
      };
    }
    return {
      left: FREE_SHIPPING_PHRASE,
      right: "Fast U.S. fulfillment • No subscriptions",
      href: "/shop",
    };
  }, [isAmerica250]);

  return (
    <div className="sticky top-0 z-[60] border-b border-[var(--border)] bg-white/92 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 text-xs text-[var(--text)]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="hidden sm:inline-block rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-2 py-0.5 text-[11px] text-[var(--text)]">
            USA Gummies
          </span>
          <span className="truncate">{left}</span>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden sm:inline text-[var(--muted)]">{right}</span>
          <Link
            href={href}
            className={cx(
              "rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-1 text-[11px] font-semibold text-[var(--text)] hover:bg-white"
            )}
          >
            Shop
          </Link>
        </div>
      </div>
    </div>
  );
}
