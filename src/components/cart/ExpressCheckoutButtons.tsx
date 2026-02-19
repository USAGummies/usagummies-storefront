// src/components/cart/ExpressCheckoutButtons.tsx
"use client";

import Image from "next/image";
import { cn } from "@/lib/cn";
import type { MouseEvent } from "react";

export const EXPRESS_CHECKOUT_METHODS = [
  {
    label: "Shop Pay",
    iconSrc: "/payments/shop-pay.svg",
    className: "bg-[#5a31f4] text-white",
    iconClassName: "h-8 w-full max-w-[150px] object-contain",
    iconWidth: 160,
    iconHeight: 40,
  },
  {
    label: "Apple Pay",
    iconSrc: "/payments/apple-pay.svg",
    className: "bg-black text-white",
    iconClassName: "h-8 w-full max-w-[150px] object-contain",
    iconWidth: 160,
    iconHeight: 40,
  },
  {
    label: "Google Pay",
    iconSrc: "/payments/google-pay.svg",
    className: "bg-black text-white",
    iconClassName: "h-8 w-full max-w-[150px] object-contain",
    iconWidth: 160,
    iconHeight: 40,
  },
] as const;

export type ExpressCheckoutButtonsProps = {
  checkoutUrl: string;
  onCheckoutClick: (event: MouseEvent<HTMLAnchorElement>, method: string) => void;
  /**
   * "branded" - large colored buttons with brand backgrounds (drawer checkout area)
   * "compact" - smaller pill-style buttons with icon + label (drawer sticky header)
   * "panel"   - bordered card wrapping the buttons (full-page order summary)
   */
  variant?: "branded" | "compact" | "panel";
};

export function ExpressCheckoutButtons({
  checkoutUrl,
  onCheckoutClick,
  variant = "branded",
}: ExpressCheckoutButtonsProps) {
  if (variant === "compact") {
    return (
      <div className="grid grid-cols-3 gap-2">
        {EXPRESS_CHECKOUT_METHODS.map((method) => (
          <a
            key={method.label}
            href={checkoutUrl}
            onClick={(event) => onCheckoutClick(event, method.label)}
            aria-label={`${method.label} checkout`}
            className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-[rgba(15,27,45,0.1)] bg-white/80 px-2 py-2 text-[9px] font-semibold text-[var(--muted)]"
          >
            <span className="flex h-9 w-full items-center justify-center rounded-full border border-[rgba(15,27,45,0.08)] bg-white">
              <Image
                src={method.iconSrc}
                alt={`${method.label} logo`}
                width={72}
                height={20}
                sizes="72px"
                className="h-4 w-auto opacity-80"
              />
            </span>
            <span className="text-[9px] text-[var(--muted)]">{method.label}</span>
          </a>
        ))}
      </div>
    );
  }

  if (variant === "panel") {
    return (
      <div className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] p-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
          Express checkout
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {EXPRESS_CHECKOUT_METHODS.map((method) => (
            <a
              key={method.label}
              href={checkoutUrl}
              onClick={(event) => onCheckoutClick(event, method.label)}
              aria-label={`${method.label} checkout`}
              className={cn(
                "flex h-12 items-center justify-center rounded-xl border border-white/10 px-3 py-2 transition hover:brightness-105 shadow-[0_10px_20px_rgba(5,10,20,0.45)]",
                method.className
              )}
            >
              <Image
                src={method.iconSrc}
                alt={`${method.label} logo`}
                width={method.iconWidth ?? 96}
                height={method.iconHeight ?? 28}
                sizes="(max-width: 480px) 100px, 120px"
                className={cn(method.iconClassName, "opacity-100")}
              />
            </a>
          ))}
        </div>
      </div>
    );
  }

  // variant === "branded" (default)
  return (
    <>
      <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
        Express checkout
      </div>
      <div className="grid grid-cols-3 gap-2">
        {EXPRESS_CHECKOUT_METHODS.map((method) => (
          <a
            key={method.label}
            href={checkoutUrl}
            onClick={(event) => onCheckoutClick(event, method.label)}
            aria-label={`${method.label} checkout`}
            className={cn(
              "flex h-12 items-center justify-center rounded-xl border border-white/10 px-3 py-2 text-[8px] font-semibold transition hover:brightness-105 shadow-[0_10px_20px_rgba(5,10,20,0.45)]",
              method.className
            )}
          >
            <span className="flex h-10 w-full items-center justify-center">
              <Image
                src={method.iconSrc}
                alt={`${method.label} logo`}
                width={method.iconWidth ?? 96}
                height={method.iconHeight ?? 28}
                sizes="(max-width: 480px) 120px, 140px"
                className={cn(method.iconClassName, "opacity-100")}
              />
            </span>
          </a>
        ))}
      </div>
    </>
  );
}
