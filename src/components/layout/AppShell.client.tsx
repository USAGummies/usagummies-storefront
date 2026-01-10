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

  async function refreshCartCount() {
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get" }),
      });
      const data = await res.json();
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
    <div className="min-h-screen bg-[var(--bg,#0c1426)] text-[var(--text)]">
      <div className="mx-auto w-full max-w-[430px] lg:max-w-[430px] min-h-screen bg-[var(--bg,#0c1426)] shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_20px_80px_rgba(0,0,0,0.45)]">
      {/* Header is the only light surface */}
      <header className="sticky top-0 z-40 bg-white text-[var(--rebel)] border-b border-[var(--red)] shadow-[0_10px_28px_rgba(0,0,0,0.12)]">
        <div className="px-4 py-3 flex items-center justify-between gap-3">
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
            <span className="text-[11px] font-black uppercase tracking-[0.18em] text-[var(--rebel)]">
              🇺🇸 American-made
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-4 text-sm font-semibold text-[var(--rebel)]">
            {navLinks.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cx(
                    "underline-slide pressable px-2 py-1 rounded-lg transition-colors duration-150 text-[var(--rebel)] hover:text-[var(--red)]",
                    active && "text-[var(--red)]"
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="pressable focus-ring inline-flex items-center gap-2 rounded-full bg-[rgba(21,36,65,0.06)] border border-[rgba(0,0,0,0.12)] px-4 py-2 text-sm font-black text-[var(--rebel)]"
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
              className="md:hidden pressable focus-ring inline-flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(0,0,0,0.12)] text-[var(--rebel)] bg-white"
              aria-label="Toggle navigation"
            >
              ☰
            </button>
          </div>
        </div>

        {mobileOpen ? (
          <div className="md:hidden border-t border-[rgba(0,0,0,0.08)] bg-white/96 backdrop-blur-md">
          <div className="px-4 py-3 flex flex-col gap-2 text-[var(--rebel)]">
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
                className="pressable focus-ring inline-flex items-center justify-center rounded-full bg-[var(--red)] px-4 py-2 text-sm font-black text-white"
              >
                View cart
              </button>
            </div>
          </div>
        ) : null}
      </header>

      <CartDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <main className="pb-16 text-[var(--text)]">{children}</main>

      <footer className="border-top border-[var(--border)] bg-[rgba(12,20,38,0.92)] backdrop-blur-md text-white">
        <div className="px-4 py-8 text-sm text-[var(--muted)] space-y-6">
          <div className="grid gap-4 md:grid-cols-[1.1fr_auto] md:items-start">
            <div className="space-y-2">
              <div className="text-lg font-black text-white">USA Gummies</div>
              <ul className="space-y-1 text-[var(--muted)]">
                <li>🇺🇸 American-made • Bold flavor</li>
                <li>✅ Dye-free • All natural</li>
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
    </div>
  );
}
