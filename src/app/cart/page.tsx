// src/app/cart/page.tsx
// LIVE COMMERCE — preserves CartView, ReviewsSummary client logic. Wraps the
// existing markup in a PageHero + cream section. Do not change cart behavior.
import type { Metadata } from "next";
import { getCart } from "@/lib/cart";
import { CartView } from "@/components/ui/CartView";
import { ReviewsSummary } from "@/components/reviews/ReviewsSummary";
import { PageHero } from "@/components/lp/PageHero";

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
    <main>
      <h1 className="sr-only">Cart</h1>

      <PageHero
        eyebrow="Your Cart"
        headline="Review"
        scriptAccent="your bags."
        sub="Adjust quantities, apply codes, and head to secure checkout when you're ready."
        ctas={[{ href: "/shop", label: "Keep shopping", variant: "light" }]}
      />

      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-12 sm:px-8 sm:py-16">
          <CartView cart={cart} />

          <div className="mt-10">
            <ReviewsSummary />
          </div>
        </div>
      </section>
    </main>
  );
}
