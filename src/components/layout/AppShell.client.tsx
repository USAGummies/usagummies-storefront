// src/components/layout/AppShell.client.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { AMAZON_LISTING_URL } from "@/lib/amazon";
import { applyExperimentFromUrl, trackEvent } from "@/lib/analytics";
import { LeadCapture } from "@/components/marketing/LeadCapture.client";
// SubscriptionUnlock removed — subscriptions not live in Shopify
import { getCartToastMessage, readLastAdd } from "@/lib/cartFeedback";
import { SINGLE_BAG_VARIANT_ID } from "@/lib/bundles/atomic";
import { ExperienceBand } from "@/components/brand/ExperienceBand";
import { getStoredCartId, storeCartId, getBagsPerUnit } from "@/lib/cartClientUtils";

const CartDrawer = dynamic(
  () => import("@/components/layout/CartDrawer.client").then((mod) => mod.CartDrawer),
  { ssr: false }
);
const ExitIntentPopup = dynamic(
  () => import("@/components/engagement/ExitIntentPopup.client"),
  { ssr: false }
);
const ScrollPopup = dynamic(
  () => import("@/components/engagement/ScrollPopup.client"),
  { ssr: false }
);

function cx(...a: Array<string | false | null | undefined>) {
  return a.filter(Boolean).join(" ");
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
      { href: "/shop", label: "Shop" },
      { href: "/bundle-guides", label: "Bag count guides" },
      { href: "/gummy-gift-bundles", label: "Gift bag options" },
      { href: "/patriotic-party-snacks", label: "Party snacks" },
      { href: "/patriotic-candy", label: "Patriotic candy" },
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
      { href: "/gummies-101", label: "Gummies 101" },
      { href: "/join-the-revolution", label: "Join the list" },
    ],
  },
  {
    title: "Support",
    links: [
      { href: "/help", label: "Help Center" },
      { href: "/wholesale", label: "Wholesale" },
      { href: "/where-to-buy", label: "Where to buy" },
      { href: "/contact", label: "Contact" },
      { href: "/policies", label: "Policies" },
      { href: "/policies/shipping", label: "Shipping" },
      { href: "/policies/returns", label: "Satisfaction guarantee" },
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
  const [hideHomeHeader, setHideHomeHeader] = useState(false);
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isShop = pathname === "/shop";
  const isProduct = pathname?.startsWith("/products");
  // /go/* and /lp/* are dedicated paid-traffic landing pages — they own
  // their own header/footer chrome, so the global AppShell stays out of
  // their way (otherwise the site nav stacks on top of the LP hero).
  const isLandingPage = pathname?.startsWith("/go") || pathname?.startsWith("/lp");
  const experienceVariant = isHome || isShop || isProduct ? "full" : "compact";
  const showExperienceBand = isHome || isShop;
  const menuRef = useRef<HTMLDivElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const amazonPrefireRef = useRef(0);
  const amazonPrefireWindowMs = 1500;
  const shouldFireAmazon = () =>
    Date.now() - amazonPrefireRef.current > amazonPrefireWindowMs;
  const markAmazonFired = () => {
    amazonPrefireRef.current = Date.now();
  };

  async function refreshCartCount() {
    try {
      const stored = getStoredCartId();
      if (stored) storeCartId(stored);
      const res = await fetch("/api/cart", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get", cartId: stored || undefined }),
      });
      const data = await res.json();
      if (data?.cart?.id) storeCartId(data.cart.id);
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
      if (updateJson?.cart?.id) storeCartId(updateJson.cart.id);
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
    if (stored) storeCartId(stored);
    refreshCartCount();
  }, []);

  useEffect(() => {
    setHideHomeHeader(false);
  }, [isHome]);

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

  useEffect(() => {
    if (!mobileOpen) return;
    const originalBody = document.body.style.overflow;
    const originalHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalBody;
      document.documentElement.style.overflow = originalHtml;
    };
  }, [mobileOpen]);

  // Landing pages render standalone — no nav, footer, or shell chrome.
  if (isLandingPage) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-[var(--bg,#f8f5ef)] text-[var(--text)]">
      {cartToast ? (
        <div className="fixed right-4 top-20 z-50 max-w-[320px]">
          <div className="relative candy-panel rounded-2xl border border-[var(--border)] px-4 py-3 text-[var(--text)] shadow-[0_18px_42px_rgba(15,27,45,0.14)]">
            <div className="pointer-events-none absolute -right-6 -top-4 h-20 w-20 opacity-12">
              <Image
                src="/website%20assets/StatueofLiberty.png"
                alt="Statue of Liberty illustration"
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
      <header
        className={cx(
          "site-header sticky top-0 z-40 border-b border-[var(--border)] bg-white/92 text-[var(--text)] backdrop-blur-md shadow-[0_10px_24px_rgba(15,27,45,0.08)] transition-[transform,opacity] duration-300",
          hideHomeHeader ? "home-header--hidden" : ""
        )}
      >
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center pressable focus-ring">
            <div className="relative h-10 w-36 sm:h-11 sm:w-40">
              <Image
                src="/brand/logo-full.png"
                alt="USA Gummies logo"
                fill
                sizes="(max-width: 640px) 144px, 160px"
                className="object-contain"
                priority
              />
            </div>
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
            <div className="hidden lg:flex items-center gap-4 text-sm font-semibold text-[var(--navy)]">
              <Link href="/gummies-101" className="link-underline">
                Learn
              </Link>
              <Link href="/blog" className="link-underline">
                Blog
              </Link>
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
              aria-expanded={mobileOpen}
            >
              ☰
            </button>
          </div>
        </div>

        <div
          className="h-[2px] w-full"
          style={{
            background: "linear-gradient(90deg, #c7362c, #1B2A4A, #c7362c)",
          }}
          aria-hidden="true"
        />

        {mobileOpen ? (
          <div className="md:hidden border-t border-[var(--border)] bg-white/96 backdrop-blur-md max-h-[calc(100vh-72px)] overflow-y-auto overscroll-contain">
            <div className="mx-auto max-w-6xl px-4 py-3 flex flex-col gap-3 text-[var(--text)]">
              <div className="flex justify-center py-2">
                <div className="relative h-10 w-36">
                  <Image
                    src="/brand/logo-full.png"
                    alt="USA Gummies"
                    fill
                    sizes="144px"
                    className="object-contain"
                  />
                </div>
              </div>
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

      {drawerOpen ? (
        <CartDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      ) : null}

      <main className="relative overflow-hidden pb-16 text-[var(--text)]">
        <Image
          src="/website%20assets/B17Bomber.png"
          alt="Vintage B-17 bomber illustration"
          aria-hidden="true"
          width={1405}
          height={954}
          sizes="(max-width: 1024px) 1px, 520px"
          className="site-watermark site-watermark--bomber"
        />
        <div className="relative z-10">{children}</div>
      </main>

      {showExperienceBand ? (
        <section className="bg-transparent -mt-6">
          <div className="mx-auto max-w-6xl px-4 pb-6">
            <ExperienceBand variant={experienceVariant} />
          </div>
        </section>
      ) : null}

      <footer className="border-t border-[var(--border)] bg-white/85 backdrop-blur-md text-[var(--text)]">
        <div
          className="h-[2px] w-full"
          style={{
            background: "linear-gradient(90deg, #c7362c, #1B2A4A, #c7362c)",
          }}
          aria-hidden="true"
        />
        <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-[var(--muted)] space-y-6">
          <div className="flex justify-center pt-2 pb-4">
            <div className="relative h-14 w-52 sm:h-16 sm:w-56">
              <Image
                src="/brand/logo-full.png"
                alt="USA Gummies"
                fill
                sizes="(max-width: 640px) 208px, 224px"
                className="object-contain"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <LeadCapture
              source="footer"
              intent="newsletter"
              title="Join the list"
              subtitle="Early drops, bag-count tips, and the occasional note."
              ctaLabel="Join the list"
              variant="light"
              emphasis="quiet"
              showSms
            />
            {/* Subscription references removed — not live in Shopify */}
          </div>

          <div className="flex flex-col items-center gap-4 rounded-2xl border border-[var(--border)] bg-[var(--bg,#f8f5ef)]/60 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="relative h-12 w-12 shrink-0">
                <Image
                  src="/brand/icon-512.png"
                  alt="USA Gummies emblem"
                  fill
                  sizes="48px"
                  className="object-contain"
                />
              </div>
              <div className="text-center text-sm font-semibold text-[var(--text)]">
                100% Made in the USA &bull; All Natural Flavors &bull; No Artificial Dyes
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
              <span>Classic gummy bear flavor</span>
              <span>Ships fast</span>
              <span>{FREE_SHIPPING_PHRASE}</span>
              <span>Satisfaction guaranteed</span>
            </div>
            <Link
              href="/made-in-usa-candy"
              className="link-underline text-xs text-[var(--muted)]"
            >
              Made in USA Candy
            </Link>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3">
            {navSections.map((section) => (
              <div key={section.title}>
                <div className="font-display text-[11px] font-black uppercase tracking-[0.2em] text-[var(--navy)]">
                  {section.title}
                </div>
                <div className="mt-2 flex flex-col gap-1">
                  {section.links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="link-underline text-[var(--muted)]"
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
            <div className="flex flex-wrap gap-3 text-[var(--muted)]">
              <Link href="/no-artificial-dyes-gummy-bears" className="link-underline">
                Dye-Free Gummy Bears
              </Link>
              <Link href="/made-in-usa-candy" className="link-underline">
                Made in USA Candy
              </Link>
            </div>
            <div className="flex flex-col items-start gap-2 text-xs text-[var(--muted)]">
              <Link href="/shop" className="btn btn-candy btn-compact">
                Shop bags
              </Link>
              <div>
                <div className="font-display text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text)]">
                  Other places to buy
                </div>
                <a
                  href={AMAZON_LISTING_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link-underline"
                  onPointerDown={() => {
                    if (!shouldFireAmazon()) return;
                    markAmazonFired();
                    trackEvent("amazon_redirect", {
                      event_category: "commerce",
                      event_label: "amazon_outbound",
                      quantity: 1,
                      sku: "AAGB-7.5OZ",
                      item_id: "AAGB-7.5OZ",
                      source_page: typeof window !== "undefined" ? window.location.pathname : "",
                      destination: "amazon",
                      destination_host: "amazon.com",
                      destination_url: AMAZON_LISTING_URL,
                      cta_location: "footer",
                      selected_flow: "amazon",
                      bundle_tier: "1",
                    });
                  }}
                  onClick={(event) => {
                    const amazonUrl = AMAZON_LISTING_URL;
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                      trackEvent("amazon_redirect", {
                        event_category: "commerce",
                        event_label: "amazon_outbound",
                        quantity: 1,
                        sku: "AAGB-7.5OZ",
                        item_id: "AAGB-7.5OZ",
                        source_page: typeof window !== "undefined" ? window.location.pathname : "",
                        destination: "amazon",
                        destination_host: "amazon.com",
                        destination_url: amazonUrl,
                        cta_location: "footer",
                        selected_flow: "amazon",
                        bundle_tier: "1",
                      });
                      return;
                    }
                    event.preventDefault();
                    let didNavigate = false;
                    const openedWindow =
                      typeof window !== "undefined"
                        ? window.open("", "_blank", "noopener,noreferrer")
                        : null;
                    const navigateToAmazon = () => {
                      if (didNavigate || typeof window === "undefined") return;
                      didNavigate = true;
                      if (openedWindow && !openedWindow.closed) {
                        openedWindow.location.href = amazonUrl;
                      } else {
                        window.open(amazonUrl, "_blank", "noopener,noreferrer");
                      }
                    };
                    if (shouldFireAmazon()) {
                      markAmazonFired();
                      trackEvent("amazon_redirect", {
                        event_category: "commerce",
                        event_label: "amazon_outbound",
                        quantity: 1,
                        sku: "AAGB-7.5OZ",
                        item_id: "AAGB-7.5OZ",
                        source_page: typeof window !== "undefined" ? window.location.pathname : "",
                        destination: "amazon",
                        destination_host: "amazon.com",
                        destination_url: amazonUrl,
                        cta_location: "footer",
                        selected_flow: "amazon",
                        bundle_tier: "1",
                        event_callback: navigateToAmazon,
                      });
                    }
                    if (typeof window !== "undefined") {
                      window.setTimeout(navigateToAmazon, 1200);
                    }
                  }}
                >
                  Amazon
                </a>
              </div>
            </div>
          </div>

          {/* Social links */}
          <div className="flex items-center justify-center gap-4 border-t border-[var(--border)] pt-4">
            <a href="https://www.instagram.com/usagummies/" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="text-[var(--muted)] hover:text-[var(--text)] transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
            </a>
            <a href="https://www.tiktok.com/@usagummies" target="_blank" rel="noopener noreferrer" aria-label="TikTok" className="text-[var(--muted)] hover:text-[var(--text)] transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 0010.86 4.48v-7.13a8.16 8.16 0 005.58 2.2V11.3a4.85 4.85 0 01-3.77-1.85V6.69h3.77z"/></svg>
            </a>
            <a href="https://www.facebook.com/usagummies" target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="text-[var(--muted)] hover:text-[var(--text)] transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            </a>
          </div>

          <div className="flex items-center justify-center gap-2 pt-3 text-xs text-[var(--muted)]">
            <div className="relative h-5 w-5 shrink-0">
              <Image
                src="/brand/icon-512.png"
                alt=""
                aria-hidden="true"
                fill
                sizes="20px"
                className="object-contain"
              />
            </div>
            <span>&copy; {new Date().getFullYear()} USA Gummies. All rights reserved.</span>
          </div>
        </div>
      </footer>
      <ExitIntentPopup />
      <ScrollPopup />
    </div>
  );
}
