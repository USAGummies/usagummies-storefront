// src/app/cart/page.tsx
import Link from "next/link";
import { getCart } from "@/lib/cart";
import { CartView } from "@/components/ui/CartView";
import { ReviewsSummary } from "@/components/reviews/ReviewsSummary";
import { PatriotBanner } from "@/components/ui/PatriotBanner";

export default async function CartPage() {
  let cart: any = null;
  try {
    cart = await getCart();
  } catch {
    cart = null;
  }

  return (
    <main className="relative overflow-hidden bg-[#fffdf8] text-[var(--text)] min-h-screen pb-16">
      <div className="mx-auto max-w-6xl px-4 pt-6">
        {/* Top nav */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--muted)]">
          <div className="flex items-center gap-2">
            <Link href="/" className="link-underline text-[var(--muted)] hover:text-[var(--text)]">
              Home
            </Link>
            <span>›</span>
            <span className="font-black text-[var(--text)]">Cart</span>
          </div>

          <div className="flex gap-2">
            <Link className="btn btn-outline" href="/shop#bundle-pricing">
              Choose bag count
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
