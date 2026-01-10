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
        left: "America 250 limited bundles",
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
    <div className="sticky top-0 z-[60] border-b border-white/10 bg-black/90 backdrop-blur supports-[backdrop-filter]:bg-black/70">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 text-xs text-white/80">
        <div className="flex min-w-0 items-center gap-2">
          <span className="hidden sm:inline-block rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] text-white/90">
            USA Gummies
          </span>
          <span className="truncate">{left}</span>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden sm:inline text-white/60">{right}</span>
          <Link
            href={href}
            className={cx(
              "rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold text-white hover:bg-white/10"
            )}
          >
            Shop →
          </Link>
        </div>
      </div>
    </div>
  );
}
