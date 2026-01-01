// src/app/page.tsx (FULL REPLACE)
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { getProductsPage } from "@/lib/shopify/products";

export const metadata: Metadata = {
  title: "USA Gummies | Premium American-Made Gummy Bears",
  description:
    "Premium American-made gummy bears. Bundle-first pricing. Fast shipping. Secure Shopify checkout.",
};

function formatMoney(amount: string | number, currency = "USD") {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return `$${amount}`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

export default async function HomePage() {
  // You have ONE product — grab just 1
  const productsPage = await getProductsPage({
    pageSize: 1,
    sort: "best-selling",
  });

  // Cast to any so TS stops complaining about fields (description, priceRange, etc.)
  const product = (productsPage?.nodes?.[0] as any) ?? null;

  // Fallbacks if Shopify returns nothing (keeps homepage from exploding)
  const handle =
    product?.handle?.toString?.() || "all-american-gummy-bears-7-5-oz-single-bag";
  const title =
    product?.title?.toString?.() || "All American Gummy Bears – 7.5 oz bag";
  const description =
    product?.description?.toString?.() ||
    "All natural flavors. No artificial dyes. Built in America. Shipped fast.";

  const priceAmount =
    product?.priceRange?.minVariantPrice?.amount ??
    product?.variants?.nodes?.[0]?.price?.amount ??
    "5.99";

  const currency =
    product?.priceRange?.minVariantPrice?.currencyCode ??
    product?.variants?.nodes?.[0]?.price?.currencyCode ??
    "USD";

  // ✅ This file exists in your public/brand folder
  const heroImg = "/brand/hero.jpg";

  return (
    <main className="bg-[#fbf1e7]">
      {/* HERO */}
      <section className="mx-auto max-w-6xl px-4 pt-10 pb-12">
        <div className="grid gap-10 md:grid-cols-2 md:items-center">
          {/* Left */}
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-black/15 bg-white/70 px-3 py-1 text-sm shadow-sm">
              <span>🇺🇸</span>
              <span>Made in the USA</span>
            </div>

            <h1 className="mt-4 text-4xl font-black leading-[1.05] tracking-tight md:text-6xl">
              Premium gummy bears.
              <br />
              Loud flavor.
              <br />
              Patriotic backbone.
            </h1>

            <p className="mt-4 max-w-prose text-base text-black/70">
              Bundle-first pricing built for higher value and faster decisions.
              Free shipping unlocks at 5+ bags. Checkout is powered by Shopify.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/shop"
                className="inline-flex items-center justify-center rounded-full bg-black px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
              >
                Shop →
              </Link>
              <Link
                href="/america-250"
                className="inline-flex items-center justify-center rounded-full border border-black/20 bg-white px-5 py-3 text-sm font-semibold shadow-sm transition hover:bg-white/80"
              >
                America 250 →
              </Link>
              <Link
                href="/cart"
                className="inline-flex items-center justify-center rounded-full border border-black/20 bg-white px-5 py-3 text-sm font-semibold shadow-sm transition hover:bg-white/80"
              >
                View cart →
              </Link>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              {[
                ["American-Made", "Built with pride. No fluff."],
                ["Fast Shipping", "Quick fulfillment & tracking."],
                ["Secure Checkout", "Shopify checkout protection."],
                ["Bundle & Save", "Bigger cart = better deal."],
              ].map(([h, p]) => (
                <div
                  key={h}
                  className="rounded-2xl border border-black/15 bg-white/70 p-4 shadow-sm"
                >
                  <div className="text-sm font-bold">{h}</div>
                  <div className="mt-1 text-xs text-black/65">{p}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right */}
          <div className="relative">
            <div className="relative mx-auto aspect-[4/3] w-full max-w-lg overflow-hidden rounded-[28px] border border-black/15 bg-white shadow-sm">
              <Image
                src={heroImg}
                alt="USA Gummies hero"
                fill
                priority
                sizes="(max-width: 768px) 92vw, 520px"
                className="object-cover"
              />
            </div>

            {/* Mini price chip */}
            <div className="mx-auto mt-4 w-full max-w-lg">
              <div className="inline-flex items-center gap-2 rounded-full border border-black/15 bg-white/80 px-4 py-2 text-sm shadow-sm">
                <span className="font-semibold">Starting at</span>
                <span className="font-black">
                  {formatMoney(priceAmount, currency)}
                </span>
                <span className="text-black/60">per bag</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PRODUCT PREVIEW (single product) */}
      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <div className="flex items-end justify-between gap-6">
            <div>
              <h2 className="text-2xl font-black tracking-tight">Best seller</h2>
              <p className="mt-1 text-sm text-black/60">
                One flagship product. Bundle pricing does the heavy lifting.
              </p>
            </div>

            <Link
              href={`/products/${handle}`}
              className="text-sm font-semibold underline underline-offset-4"
            >
              View product →
            </Link>
          </div>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {/* Left card */}
            <div className="rounded-3xl border border-black/10 bg-[#fbf1e7] p-8 shadow-sm">
              <div className="text-xs font-semibold tracking-[0.22em] text-black/50">
                USA GUMMIES
              </div>

              <div className="mt-3 flex items-start justify-between gap-6">
                <h3 className="text-2xl font-black leading-tight">{title}</h3>
                <div className="text-right">
                  <div className="text-xs text-black/50">Starting at</div>
                  <div className="text-2xl font-black">
                    {formatMoney(priceAmount, currency)}
                  </div>
                  <div className="text-xs text-black/50">per bag (base)</div>
                </div>
              </div>

              <p className="mt-3 max-w-prose text-sm text-black/70">
                {description}
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                {["🇺🇸 Made in USA", "✅ Dye-free", "🚚 Ships fast"].map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-black/15 bg-white/70 px-3 py-1 text-xs font-semibold"
                  >
                    {t}
                  </span>
                ))}
              </div>

              <div className="mt-6 rounded-2xl border border-black/10 bg-white p-4">
                <div className="text-sm font-bold">Why this converts</div>
                <div className="mt-1 text-sm text-black/65">
                  Choose a bundle on the product page. The cart handles the
                  nudging. Free shipping at 5+.
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href={`/products/${handle}`}
                  className="inline-flex items-center justify-center rounded-full bg-black px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
                >
                  Build a bundle →
                </Link>
                <Link
                  href="/cart"
                  className="inline-flex items-center justify-center rounded-full border border-black/20 bg-white px-5 py-3 text-sm font-semibold shadow-sm transition hover:bg-white/80"
                >
                  Go to cart →
                </Link>
              </div>
            </div>

            {/* Right card: bundle ladder preview (static, points to PDP) */}
            <div className="rounded-3xl border border-black/10 bg-white p-8 shadow-sm">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <div className="text-xs font-semibold tracking-[0.22em] text-black/50">
                    BUNDLE & SAVE
                  </div>
                  <div className="mt-2 text-2xl font-black">Pick your bundle</div>
                  <div className="mt-2 text-sm text-black/60">
                    Bundle totals shown below. Free shipping unlocks at 5+.
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-black/50">Base price</div>
                  <div className="text-lg font-black">
                    {formatMoney(priceAmount, currency)}
                    <span className="text-xs font-semibold text-black/50">
                      /bag
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-4">
                {[
                  ["1 Bag", "Try it", 1],
                  ["2 Bags", "Stock up", 2],
                  ["4 Bags", "Better value", 4],
                  ["5 Bags", "Free shipping tier", 5, "Most popular"],
                  ["8 Bags", "Best deal", 8, "Best value"],
                  ["12 Bags", "Party pack", 12, "Best value"],
                ].map(([label, sub, qty, badge]) => {
                  const total = Number(priceAmount) * (qty as number);
                  const isPopular = label === "5 Bags";
                  const isFreeShip = (qty as number) >= 5;

                  return (
                    <div
                      key={label as string}
                      className={[
                        "rounded-2xl border p-4 shadow-sm",
                        isPopular
                          ? "border-red-300 bg-red-50"
                          : "border-black/10 bg-white",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-black leading-tight">
                            {label}
                          </div>
                          <div className="mt-1 text-sm text-black/60">
                            {sub}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-black/50">Total</div>
                          <div className="text-lg font-black">
                            {formatMoney(total.toFixed(2), currency)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {badge ? (
                          <span className="rounded-full bg-white px-2 py-1 text-xs font-bold">
                            {badge as string}
                          </span>
                        ) : null}
                        {isFreeShip ? (
                          <span className="text-xs font-black text-red-600">
                            FREE SHIPPING
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-5 rounded-2xl border border-black/10 bg-[#fbf1e7] p-4 text-sm text-black/70">
                Tip: 5+ bags unlocks free shipping. 8+ is usually the best value
                per checkout.
              </div>

              <Link
                href={`/products/${handle}`}
                className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-black px-5 py-4 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
              >
                Build your bundle on the product page →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
