// src/app/cart/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { getCart } from "@/lib/cart";
import { CartView } from "@/components/ui/CartView";
import { ReviewsSummary } from "@/components/reviews/ReviewsSummary";
import { PatriotBanner } from "@/components/ui/PatriotBanner";

function resolveSiteUrl() {
  const preferred = "https://www.usagummies.com";
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || null;
  const nodeEnv = (process.env.NODE_ENV as string | undefined) || "";
  if (fromEnv && fromEnv.includes("usagummies.com")) return fromEnv.replace(/\/$/, "");
  if (nodeEnv === "production") return preferred;
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : null;
  if (vercel) return vercel;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (nodeEnv !== "production") return "http://localhost:3000";
  return preferred;
}

const SITE_URL = resolveSiteUrl();
const PAGE_TITLE = "Cart | USA Gummies";
const PAGE_DESCRIPTION = "Review your USA Gummies order and proceed to secure checkout.";
const OG_IMAGE = "/opengraph-image";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  robots: { index: false, follow: false },
  alternates: { canonical: `${SITE_URL}/cart` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/cart`,
    type: "website",
    images: [{ url: OG_IMAGE }],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default async function CartPage() {
  let cart: any = null;
  try {
    cart = await getCart();
  } catch {
    cart = null;
  }

  return (
    <main className="relative overflow-hidden home-hero-theme text-[var(--text)] min-h-screen pb-16">
      <h1 className="sr-only">Cart</h1>
      <div className="mx-auto max-w-6xl px-4 pt-6">
        {/* Top nav */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-white/70">
          <div className="flex items-center gap-2">
            <Link href="/" className="link-underline text-white/70 hover:text-white">
              Home
            </Link>
            <span>›</span>
            <span className="font-black text-white">Cart</span>
          </div>

          <div className="flex gap-2">
            <Link className="btn btn-outline" href="/shop#bundle-pricing">
              Shop now
            </Link>
          </div>
        </div>

        {/* Hero + mission */}
        <div className="mt-4">
          <PatriotBanner showRibbon={false} />
        </div>

        <div className="mt-6">
          <CartView cart={cart} />
        </div>

        <div className="mt-6">
          <ReviewsSummary />
        </div>
      </div>
    </main>
  );
}
