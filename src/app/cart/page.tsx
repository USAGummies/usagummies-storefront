// src/app/cart/page.tsx
import Link from "next/link";
import { getCart } from "@/lib/cart";
import { CartView } from "@/components/ui/CartView";
import { ReviewsSummary } from "@/components/reviews/ReviewsSummary";
import { PatriotBanner } from "@/components/ui/PatriotBanner";
import { PatriotRibbon } from "@/components/ui/PatriotRibbon";

export default async function CartPage() {
  let cart: any = null;
  try {
    cart = await getCart();
  } catch {
    cart = null;
  }

  return (
    <main className="pb-16">
      <div className="container mx-auto px-4">
        {/* Top nav */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 text-[var(--muted)] text-sm">
          <div className="flex items-center gap-2">
            <Link href="/" className="link-underline">
              Home
            </Link>
            <span>›</span>
            <span className="font-black text-white">Cart</span>
          </div>

          <div className="flex gap-2">
            <Link className="btn" href="/shop">
              Keep shopping →
            </Link>
          </div>
        </div>

        {/* Hero + mission */}
        <div className="mt-4">
          <PatriotBanner />
          <div className="mt-3">
            <PatriotRibbon />
          </div>
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
