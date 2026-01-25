// src/components/layout/AppShell.client.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { CartDrawer } from "@/components/layout/CartDrawer.client";
import { usePathname } from "next/navigation";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { AMAZON_LISTING_URL } from "@/lib/amazon";
import { applyExperimentFromUrl, trackEvent } from "@/lib/analytics";
import { LeadCapture } from "@/components/marketing/LeadCapture.client";
import { SubscriptionUnlock } from "@/components/marketing/SubscriptionUnlock.client";
import { getCartToastMessage, readLastAdd } from "@/lib/cartFeedback";
import { SINGLE_BAG_VARIANT_ID } from "@/lib/bundles/atomic";
import { BRAND_STORY_HEADLINE, BRAND_STORY_SHORT } from "@/data/brandStory";

function cx(...a: Array<string | false | null | undefined>) {
  return a.filter(Boolean).join(" ");
}

function getStoredCartId() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("cartId");
  } catch {
    return null;
  }
}

function setCartCookie(cartId?: string | null) {
  if (!cartId || typeof document === "undefined") return;
  document.cookie = `cartId=${cartId}; path=/; samesite=lax`;
}

function formatMoney(amount: string | number | null | undefined, currency = "USD") {
  const raw = typeof amount === "string" ? Number(amount) : Number(amount ?? 0);
  if (!Number.isFinite(raw)) return "$0.00";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(raw);
  } catch {
    return `$${raw.toFixed(2)}`;
  }
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

function summarizeCart(cart: any) {
  const lines =
    cart?.lines?.nodes ??
    cart?.lines?.edges?.map((e: any) => e?.node) ??
    [];
  if (!lines.length) {
    return { totalBags: 0, summary: null as string | null };
  }
  const totalBags = lines.reduce((sum: number, l: any) => {
    const bagsPerUnit = getBagsPerUnit(l?.merchandise);
    const qty = Number(l?.quantity) || 0;
    return sum + bagsPerUnit * qty;
  }, 0);
  const amount = cart?.cost?.subtotalAmount?.amount;
  const currency = cart?.cost?.subtotalAmount?.currencyCode || "USD";
  const totalText = formatMoney(amount, currency);
  const summary =
    totalBags > 0 ? `${totalBags} bags - ${totalText}` : null;
  return { totalBags, summary };
}

const navSections = [
  {
    title: "Shop",
    links: [
      { href: "/shop", label: "Shop now and save" },
      { href: "/bundle-guides", label: "Bag count guides" },
      { href: "/gummy-gift-bundles", label: "Gift bag options" },
      { href: "/patriotic-party-snacks", label: "Party snacks" },
      { href: "/bulk-gummy-bears", label: "Bulk gummy bears" },
    ],
  },
  {
    title: "Brand",
    links: [
      { href: "/about", label: "About" },
      { href: "/made-in-usa", label: "Made in USA" },
      { href: "/ingredients", label: "Ingredients" },
      { href: "/faq", label: "FAQ" },
      { href: "/join-the-revolution", label: "Join the Revolution" },
    ],
  },
  {
    title: "Support",
    links: [
      { href: "/contact", label: "Contact" },
      { href: "/policies", label: "Policies" },
      { href: "/policies/shipping", label: "Shipping" },
      { href: "/policies/returns", label: "Returns" },
      { href: "/policies/privacy", label: "Privacy" },
      { href: "/policies/terms", label: "Terms" },
    ],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cartCount, setCartCount] = useState<number>(0);
  const [cartSummary, setCartSummary] = useState<string | null>(null);
  const [badgePop, setBadgePop] = useState(false);
  const [cartToast, setCartToast] = useState<string | null>(null);
  const [undoInfo, setUndoInfo] = useState<{ qty: number; at: number } | null>(null);
  const [undoPending, setUndoPending] = useState(false);
  const pathname = usePathname();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  async function refreshCartCount() {
    try {
      const stored = getStoredCartId();
      if (stored) setCartCookie(stored);
      const res = await fetch("/api/cart", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get", cartId: stored || undefined }),
      });
      const data = await res.json();
      if (data?.cart?.id) setCartCookie(data.cart.id);
      const summary = summarizeCart(data?.cart ?? null);
      const qty = Number(summary.totalBags || 0);
      setCartCount((prev) => {
        if (qty !== prev) {
          setBadgePop(true);
          setTimeout(() => setBadgePop(false), 280);
        }
        return qty;
      });
      setCartSummary(summary.summary);
    } catch {
      // ignore
    }
  }

  async function handleUndo() {
    if (!undoInfo || undoPending) return;
    setUndoPending(true);
    try {
      const stored = getStoredCartId();
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get", cartId: stored || undefined }),
      });
      const data = await res.json();
      const lines =
        data?.cart?.lines?.nodes ??
        data?.cart?.lines?.edges?.map((e: any) => e?.node) ??
        [];
      const line = lines.find((l: any) => l?.merchandise?.id === SINGLE_BAG_VARIANT_ID);
      if (!line) throw new Error("Nothing to undo.");
      const currentQty = Number(line?.quantity ?? 0);
      const nextQty = Math.max(0, currentQty - undoInfo.qty);
      if (nextQty === currentQty) {
        throw new Error("Undo unavailable.");
      }
      const updateRes = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          lineId: line.id,
          quantity: nextQty,
          cartId: stored || undefined,
        }),
      });
      const updateJson = await updateRes.json().catch(() => ({}));
      if (!updateRes.ok || updateJson?.ok === false) {
        throw new Error(updateJson?.error || "Undo failed.");
      }
      if (updateJson?.cart?.id) setCartCookie(updateJson.cart.id);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("cart:updated"));
      }
      setCartToast("Undo applied.");
      setUndoInfo(null);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => {
        setCartToast(null);
      }, 2200);
    } catch {
      setCartToast("Could not undo.");
    } finally {
      setUndoPending(false);
    }
  }

  useEffect(() => {
    setMobileOpen(false);
    setMenuOpen(false);
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    trackEvent("page_view", { path: pathname });
  }, [pathname]);

  useEffect(() => {
    const stored = getStoredCartId();
    if (stored) setCartCookie(stored);
    refreshCartCount();
  }, []);

  useEffect(() => {
    applyExperimentFromUrl();
  }, []);

  useEffect(() => {
    function handleCartUpdated() {
      refreshCartCount();
      if (pathname !== "/cart") {
        setDrawerOpen(true);
      }
    }
    window.addEventListener("cart:updated", handleCartUpdated);
    return () => window.removeEventListener("cart:updated", handleCartUpdated);
  }, [pathname]);

  useEffect(() => {
    function handleToast(event: Event) {
      const detail = (event as CustomEvent<{ qty?: number }>).detail;
      const qty = Number(detail?.qty ?? 0);
      setCartToast(getCartToastMessage(qty));
      const lastAdd = readLastAdd();
      const canUndo =
        lastAdd &&
        Number.isFinite(lastAdd.qty) &&
        lastAdd.qty > 0 &&
        Date.now() - lastAdd.at < 20000;
      setUndoInfo(canUndo ? { qty: lastAdd.qty, at: lastAdd.at } : null);
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      const duration = canUndo ? 6000 : 2600;
      toastTimerRef.current = window.setTimeout(() => {
        setCartToast(null);
        setUndoInfo(null);
      }, duration);
    }
    window.addEventListener("cart:toast", handleToast);
    return () => {
      window.removeEventListener("cart:toast", handleToast);
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(event: MouseEvent) {
      if (!menuRef.current || !event.target) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  return (
    <div className="min-h-screen bg-[var(--bg,#f8f5ef)] text-[var(--text)]">
      {cartToast ? (
        <div className="fixed right-4 top-20 z-50 max-w-[320px]">
          <div className="relative candy-panel rounded-2xl border border-[var(--border)] px-4 py-3 text-[var(--text)] shadow-[0_18px_42px_rgba(15,27,45,0.14)]">
            <div className="pointer-events-none absolute -right-6 -top-4 h-20 w-20 opacity-12">
              <Image
                src="/website%20assets/StatueofLiberty.png"
                alt=""
                aria-hidden="true"
                fill
                sizes="80px"
                className="object-contain"
              />
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
              Added to cart
            </div>
            <div className="mt-1 text-sm font-semibold text-[var(--text)]">{cartToast}</div>
            {undoInfo ? (
              <button
                type="button"
                onClick={handleUndo}
                disabled={undoPending}
                className="mt-2 inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1 text-[11px] font-semibold text-[var(--text)] hover:border-[rgba(15,27,45,0.3)]"
              >
                {undoPending ? "Undoing..." : "Undo"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-white/92 text-[var(--text)] backdrop-blur-md shadow-[0_10px_24px_rgba(15,27,45,0.08)]">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-3 pressable focus-ring">
            <div className="relative h-9 w-32">
              <Image
                src="/brand/logo.png"
                alt="USA Gummies"
                fill
                sizes="128px"
                className="object-contain"
                priority
              />
            </div>
            <span className="text-[11px] font-black uppercase tracking-[0.18em] text-[var(--navy)]">
              🇺🇸 Made in the USA
            </span>
          </Link>

          <div className="flex items-center gap-2">
            <div ref={menuRef} className="relative hidden md:block">
              <button
                type="button"
                onClick={() => setMenuOpen((s) => !s)}
                className="pressable focus-ring inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm font-black text-[var(--navy)]"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-controls="header-menu"
              >
                Menu
                <span aria-hidden="true">▾</span>
              </button>
              {menuOpen ? (
                <div
                  id="header-menu"
                  role="menu"
                  className="absolute right-0 top-full mt-2 w-[320px] sm:w-[420px] rounded-2xl border border-[var(--border)] bg-white/95 p-3 text-sm text-[var(--text)] shadow-[0_18px_48px_rgba(15,27,45,0.16)] backdrop-blur-md"
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    {navSections.map((section) => (
                      <div key={section.title}>
                        <div className="px-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                          {section.title}
                        </div>
                        <div className="mt-2 grid gap-1">
                          {section.links.map((link) => {
                            const active = pathname === link.href;
                            return (
                              <Link
                                key={link.href}
                                href={link.href}
                                role="menuitem"
                                className={cx(
                                  "pressable block rounded-xl border border-transparent px-3 py-2 font-semibold transition-colors",
                                  active
                                    ? "bg-[var(--navy)]/12 text-[var(--navy)] border-[var(--navy)]/25"
                                    : "text-[var(--text)] hover:bg-[var(--navy)]/10"
                                )}
                                onClick={() => setMenuOpen(false)}
                              >
                                {link.label}
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="pressable focus-ring inline-flex items-center gap-2 rounded-full bg-[var(--surface-strong)] border border-[var(--border)] px-4 py-2 text-sm font-black text-[var(--text)]"
            >
              <span className="flex flex-col items-start leading-tight">
                <span>Cart</span>
                {cartSummary ? (
                  <span className="hidden md:block text-[10px] font-semibold text-[var(--muted)]">
                    {cartSummary}
                  </span>
                ) : null}
              </span>
              <span
                className={cx(
                  "inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-[var(--red)] text-white text-xs font-black px-1 transition-transform",
                  badgePop && "badge-pop",
                  cartSummary && "md:hidden"
                )}
              >
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setMobileOpen((s) => !s)}
              className="md:hidden pressable focus-ring inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] text-[var(--text)] bg-white"
              aria-label="Toggle navigation"
            >
              ☰
            </button>
          </div>
        </div>

        {mobileOpen ? (
          <div className="md:hidden border-t border-[var(--border)] bg-white/96 backdrop-blur-md">
            <div className="mx-auto max-w-6xl px-4 py-3 flex flex-col gap-3 text-[var(--text)]">
              {navSections.map((section) => (
                <div
                  key={section.title}
                  className="rounded-2xl border border-[var(--border)] bg-white/90 p-3"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    {section.title}
                  </div>
                  <div className="mt-2 grid gap-1">
                    {section.links.map((link) => {
                      const active = pathname === link.href;
                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          className={cx(
                            "pressable px-2 py-2 rounded-lg",
                            active && "text-[var(--red)] font-black"
                          )}
                        >
                          {link.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="pressable focus-ring inline-flex items-center justify-center rounded-full bg-[var(--navy)] px-4 py-2 text-sm font-black text-white"
              >
                View cart
              </button>
            </div>
          </div>
        ) : null}
      </header>

      <CartDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <main className="pb-16 text-[var(--text)]">{children}</main>

      <footer className="border-t border-[var(--border)] bg-white/85 backdrop-blur-md text-[var(--text)]">
        <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-[var(--muted)] space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <LeadCapture
              source="footer"
              intent="newsletter"
              title="Join the revolution"
              subtitle="Early drops, savings alerts, and patriotic releases."
              ctaLabel="Join the list"
              variant="light"
              emphasis="quiet"
              showSms
            />
            <SubscriptionUnlock source="footer" variant="light" />
          </div>

          <div className="grid gap-4 md:grid-cols-[1.1fr_auto] md:items-start">
            <div className="space-y-2">
              <div className="text-lg font-black text-[var(--text)]">USA Gummies</div>
              <ul className="space-y-1 text-[var(--muted)]">
                <li>🇺🇸 Made in the USA • Classic gummy bear flavor</li>
                <li>✅ No artificial dyes • All natural flavors</li>
                <li>🚚 Ships fast • Save more with more bags</li>
              </ul>
            </div>
              <div className="text-xs text-[var(--muted)]">
                Secure checkout • {FREE_SHIPPING_PHRASE} • Easy returns
              </div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4 text-sm text-[var(--muted)]">
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
              Our story
            </div>
            <div className="mt-2 text-sm font-semibold text-[var(--text)]">
              {BRAND_STORY_HEADLINE}
            </div>
            <div className="mt-3 space-y-2 text-xs text-[var(--muted)]">
              {BRAND_STORY_SHORT.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            <Link href="/about" className="mt-3 inline-flex text-xs font-semibold text-[var(--navy)] link-underline">
              Read our story
            </Link>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
            <div className="flex flex-wrap gap-3 text-[var(--muted)]">
              <Link href="/shop" className="link-underline">
                Shop
              </Link>
              <Link href="/about" className="link-underline">
                About
              </Link>
              <Link href="/join-the-revolution" className="link-underline">
                Join the Revolution
              </Link>
              <Link href="/faq" className="link-underline">
                FAQ
              </Link>
              <Link href="/ingredients" className="link-underline">
                Ingredients
              </Link>
              <Link href="/made-in-usa" className="link-underline">
                Made in USA
              </Link>
              <Link href="/bundle-guides" className="link-underline">
                Bag count guides
              </Link>
              <Link href="/gummy-gift-bundles" className="link-underline">
                Gift bag options
              </Link>
              <Link href="/patriotic-party-snacks" className="link-underline">
                Party snacks
              </Link>
              <Link href="/bulk-gummy-bears" className="link-underline">
                Bulk gummy bears
              </Link>
              <Link href="/contact" className="link-underline">
                Contact
              </Link>
              <Link href="/policies" className="link-underline">
                Policies
              </Link>
              <Link href="/policies/shipping" className="link-underline">
                Shipping
              </Link>
            </div>
            <div className="text-xs text-[var(--muted)]">
              <div className="font-semibold text-[var(--text)]">Other places to buy</div>
              <a
                href={AMAZON_LISTING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="link-underline"
              >
                Amazon
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
