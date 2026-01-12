// src/components/ui/CartView.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { CartLineControls } from "@/components/cart/CartLineControls.client";
import AddBagButton from "@/components/cart/AddBagButton.client";
import { PatriotRibbon } from "@/components/ui/PatriotRibbon";
import { cn } from "@/lib/cn";
import { pricingForQty, FREE_SHIP_QTY, FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { AMAZON_LISTING_URL } from "@/lib/amazon";

type MoneyV2 = { amount: string; currencyCode: string };

function formatMoney(amount: MoneyV2 | null | undefined) {
  const n = Number(amount?.amount ?? 0);
  const currency = String(amount?.currencyCode ?? "USD");
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function clampPct(pct: number) {
  return Math.max(0, Math.min(100, pct));
}

function parseBagsFromTitle(title?: string): number | undefined {
  const t = (title || "").toLowerCase();
  if (t.includes("single")) return 1;
  const m = t.match(/(\d+)\s*(?:bag|bags)\b/);
  if (m?.[1]) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) return n;
  }
  const fallback = t.match(/(\d+)/);
  if (fallback?.[1]) {
    const n = Number(fallback[1]);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function getBagsPerUnit(merchandise: any): number {
  const meta =
    merchandise?.bundleQty?.value ??
    merchandise?.bundleBags?.value ??
    merchandise?.metafield?.value;
  const metaNum = Number(meta);
  if (Number.isFinite(metaNum) && metaNum > 0) return metaNum;

  const parsed = parseBagsFromTitle(merchandise?.title);
  if (parsed && parsed > 0) return parsed;

  return 1;
}

export function CartView({ cart, onClose }: { cart: any; onClose?: () => void }) {
  const [localCart, setLocalCart] = useState(cart);
  const refreshCart = useMemo(
    () => () => {
      const cartId =
        typeof window !== "undefined" ? window.localStorage.getItem("cartId") : null;
      fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get", cartId: cartId || undefined }),
      })
        .then((r) => r.json())
        .then((data) => {
          const nextCart = data.cart ?? null;
          if (nextCart?.id && typeof window !== "undefined") {
            try {
              window.localStorage.setItem("cartId", nextCart.id);
            } catch {
              // ignore
            }
          }
          setLocalCart(nextCart);
        })
        .catch(() => {});
    },
    []
  );

  const lines =
    (localCart?.lines as any)?.nodes ??
    (localCart?.lines as any)?.edges?.map((e: any) => e?.node) ??
    [];

  const totalBags = lines.reduce((sum: number, l: any) => {
    const bagsPerUnit = getBagsPerUnit(l?.merchandise);
    const qty = Number(l?.quantity) || 0;
    return sum + bagsPerUnit * qty;
  }, 0);
  const remaining = Math.max(0, FREE_SHIP_QTY - totalBags);
  const primaryLine = lines[0] || null;

  const bundlePricing = totalBags > 0 ? pricingForQty(totalBags) : null;
  const subtotal = bundlePricing
    ? formatMoney({ amount: bundlePricing.total.toFixed(2), currencyCode: "USD" })
    : localCart?.cost?.subtotalAmount
      ? formatMoney(localCart.cost.subtotalAmount as MoneyV2)
      : "";

  const pct = clampPct(Math.round((totalBags / FREE_SHIP_QTY) * 100));
  const unlocked = totalBags >= FREE_SHIP_QTY;
  const [justUnlocked, setJustUnlocked] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => {
    if (unlocked) {
      setJustUnlocked(true);
      const t = setTimeout(() => setJustUnlocked(false), 900);
      return () => clearTimeout(t);
    }
  }, [unlocked]);

  return (
    <div className="px-4 py-4 flex flex-col gap-4 text-[var(--text)]">
      <div className="glass-bar">
        <div className="text-sm font-black text-[var(--text)]">
          {FREE_SHIPPING_PHRASE}
        </div>
        <div className="mt-1 text-xs text-[var(--muted)]">
          {unlocked
            ? "Unlocked."
            : `Add ${remaining} more bag${remaining === 1 ? "" : "s"} to unlock ${FREE_SHIPPING_PHRASE}.`}
        </div>
        <div
          className={cn(
            "mt-3 h-2 w-full overflow-hidden rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.10)]",
            justUnlocked && "ring-2 ring-[var(--red)]"
          )}
        >
          <div
            className={cn(
              "h-full bg-gradient-to-r from-[var(--navy)] to-[var(--red)] transition-all",
              justUnlocked && "animate-pbxPulse"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        {!unlocked && primaryLine?.id ? (
          <div className="mt-3 flex gap-2 flex-wrap">
            <AddBagButton
              lineId={primaryLine.id}
              currentQty={primaryLine.quantity || 1}
              label="Add 1 bag to unlock"
              onAdded={refreshCart}
              onPending={(p) => setUpgrading(p)}
            />
            <Link href="/shop?focus=bundles" className="btn pressable">
              Browse bundles
            </Link>
            {upgrading ? <span className="text-xs text-[var(--muted)]">Updating…</span> : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        {lines.length === 0 ? (
          <div className="glass-card p-4 text-sm text-[var(--muted)]">Your cart is empty.</div>
        ) : (
          lines.map((l: any) => {
            const title = l?.merchandise?.product?.title || "Item";
            const variant = l?.merchandise?.title || "";
            const img =
              l?.merchandise?.image?.url ||
              l?.merchandise?.product?.featuredImage?.url ||
              null;
            const lineQty = Number(l?.quantity) || 0;
            const bagsPerUnit = getBagsPerUnit(l?.merchandise);
            const lineBags = bagsPerUnit * lineQty;
            const lineCurrency = l?.cost?.totalAmount?.currencyCode || "USD";
            const lineTotal = lineBags
              ? formatMoney({ amount: pricingForQty(lineBags).total.toFixed(2), currencyCode: lineCurrency })
              : l.cost?.totalAmount
                ? formatMoney(l.cost.totalAmount as MoneyV2)
                : "";
            return (
              <div key={l.id} className="glass-card p-4 flex gap-3 hover-lift">
                <div
                  className="relative h-14 w-14 rounded-xl overflow-hidden border border-[var(--border)] bg-[rgba(255,255,255,0.06)]"
                  aria-hidden="true"
                >
                  {img ? (
                    <Image src={img} alt={title} fill className="object-cover" />
                  ) : null}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-black text-[var(--text)] leading-tight">{title}</div>
                  {variant ? (
                    <div className="text-xs text-[var(--muted)] mt-1">{variant}</div>
                  ) : null}
                  <div className="mt-2">
                    <CartLineControls lineId={l.id} quantity={l.quantity} onChange={refreshCart} />
                  </div>
                </div>
                <div className="text-right text-sm font-black text-[var(--text)]">
                  {lineTotal}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="glass-card p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between text-sm text-[var(--muted)]">
          <span>Subtotal</span>
          <span className="font-black text-[var(--text)]">{subtotal}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {localCart?.checkoutUrl ? (
            <a
              href={localCart.checkoutUrl}
              className="btn btn-red w-full justify-center pressable"
              onClick={onClose}
            >
              Checkout →
            </a>
          ) : null}
          <Link href="/cart" className="btn w-full justify-center pressable" onClick={onClose}>
            View cart
          </Link>
        </div>
      </div>

      {totalBags > 0 && totalBags <= 3 ? (
        <div className="glass-card p-4">
          <div className="kicker">Also on Amazon</div>
          <div className="mt-1 text-sm text-[var(--text)]">
            Prefer 1-3 bags? Buy from our official Amazon listing for full product details.
          </div>
          <a
            href={AMAZON_LISTING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-[var(--navy)] underline underline-offset-4 hover:text-[var(--text)]"
          >
            View Amazon listing →
          </a>
        </div>
      ) : null}

      <div className="glass-card p-4">
        <div className="kicker">Pro tip</div>
        <div className="mt-1 text-sm text-[var(--text)]">
          {totalBags >= 8
            ? "You’re at the best per-bag price. Checkout to lock it in."
            : "Pro tip: 8+ bags gives you the best per-bag price."}
        </div>
      </div>

      <div className="mt-2">
        <PatriotRibbon />
      </div>
    </div>
  );
}
