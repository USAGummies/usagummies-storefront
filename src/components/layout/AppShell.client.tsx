// src/components/layout/AppShell.client.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { CartDrawer } from "@/components/layout/CartDrawer.client";
import { usePathname } from "next/navigation";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";

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
  { href: "/contact", label: "Contact" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cartCount, setCartCount] = useState<number>(0);
  const [badgePop, setBadgePop] = useState(false);
  const pathname = usePathname();
  const bundleCtaHref =
    "/products/all-american-gummy-bears-7-5-oz-single-bag?focus=bundles";

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
  }, [pathname]);

  useEffect(() => {
    const stored = getStoredCartId();
    if (stored) setCartCookie(stored);
    refreshCartCount();
  }, []);

  useEffect(() => {
    function handleCartUpdated() {
      refreshCartCount();
      setDrawerOpen(true);
    }
    window.addEventListener("cart:updated", handleCartUpdated);
    return () => window.removeEventListener("cart:updated", handleCartUpdated);
  }, []);

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

          <nav className="hidden md:flex items-center gap-4 text-sm font-semibold text-[var(--text)]">
            {navLinks.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cx(
                    "underline-slide pressable px-2 py-1 rounded-lg transition-colors duration-150 text-[var(--text)] hover:text-[var(--red)]",
                    active && "text-[var(--red)]"
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href={bundleCtaHref}
              className="hidden md:inline-flex btn btn-red"
            >
              Build a bundle
            </Link>
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
              <Link
                href={bundleCtaHref}
                className="pressable focus-ring inline-flex items-center justify-center rounded-full bg-[var(--red)] px-4 py-2 text-sm font-black text-white"
              >
                Build a bundle
              </Link>
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
          </div>
        </div>
      </footer>
    </div>
  );
}
