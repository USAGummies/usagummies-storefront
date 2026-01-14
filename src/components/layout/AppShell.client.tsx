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

const navLinks = [
  { href: "/shop", label: "Shop" },
  { href: "/about", label: "About" },
  { href: "/join-the-revolution", label: "Join the Revolution" },
  { href: "/contact", label: "Contact" },
  { href: "/policies", label: "Policies" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cartCount, setCartCount] = useState<number>(0);
  const [badgePop, setBadgePop] = useState(false);
  const pathname = usePathname();
  const menuRef = useRef<HTMLDivElement | null>(null);

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
      const qty = Number(data?.cart?.totalQuantity || 0);
      setCartCount((prev) => {
        if (qty !== prev) {
          setBadgePop(true);
          setTimeout(() => setBadgePop(false), 280);
        }
        return qty;
      });
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    setMobileOpen(false);
    setMenuOpen(false);
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
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-white/92 text-[var(--text)] backdrop-blur-md shadow-[0_10px_24px_rgba(15,27,45,0.08)]">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-3 pressable focus-ring">
            <div className="relative h-9 w-32">
              <Image
                src="/brand/logo.png"
                alt="USA Gummies"
                fill
                sizes="128px"
                unoptimized
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
                  className="absolute right-0 top-full mt-2 min-w-[200px] rounded-2xl border border-[var(--border)] bg-white/95 p-2 text-sm text-[var(--text)] shadow-[0_18px_48px_rgba(15,27,45,0.16)] backdrop-blur-md"
                >
                  {navLinks.map((link) => {
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
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="pressable focus-ring inline-flex items-center gap-2 rounded-full bg-[var(--surface-strong)] border border-[var(--border)] px-4 py-2 text-sm font-black text-[var(--text)]"
            >
              <span>Cart</span>
              <span
                className={cx(
                  "inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-[var(--red)] text-white text-xs font-black px-1 transition-transform",
                  badgePop && "badge-pop"
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
            <div className="mx-auto max-w-6xl px-4 py-3 flex flex-col gap-2 text-[var(--text)]">
            {navLinks.map((link) => {
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
              subtitle="Early drops, bundle alerts, and patriotic releases."
              ctaLabel="Join the list"
              variant="light"
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
                <li>🚚 Ships fast • Bundle &amp; save</li>
              </ul>
            </div>
            <div className="text-xs text-[var(--muted)]">
              Secure checkout • {FREE_SHIPPING_PHRASE} • Easy returns
            </div>
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
              <Link href="/contact" className="link-underline">
                Contact
              </Link>
              <Link href="/policies" className="link-underline">
                Policies
              </Link>
              <Link href="/shipping" className="link-underline">
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
