// src/app/shop/page.tsx (FULL REPLACE)
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ShopToolbar } from "@/components/shop/ShopToolbar";
import { ShopProductCard } from "@/components/shop/ShopProductCard";
import BundleQuickBuy from "@/components/home/BundleQuickBuy.client";
import { getProductsPage, type SortValue } from "@/lib/shopify/products";
import { getProductByHandle, money } from "@/lib/storefront";
import { getBundleVariants } from "@/lib/bundles/getBundleVariants";
import { pricingForQty, FREE_SHIP_QTY, FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";

const PAGE_SIZE = 18;
function resolveSiteUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : null;
  if (vercel) return vercel;
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return "https://www.usagummies.com";
}

const SITE_URL = resolveSiteUrl();

function coerceSort(v?: string): SortValue {
  switch ((v ?? "").toLowerCase()) {
    case "best-selling":
    case "best":
      return "best-selling";
    case "newest":
      return "newest";
    case "price-asc":
      return "price-asc";
    case "price-desc":
      return "price-desc";
    case "featured":
    default:
      return "best-selling";
  }
}

function hasBundleVariants(product: any) {
  const variants =
    product?.variants?.nodes ||
    product?.variants?.edges?.map((e: any) => e.node) ||
    [];
  return variants.some((v: any) => {
    const t = (v?.title || "").toLowerCase();
    const match = t.match(/(\d+)\s*(bag|bags)/);
    if (match && Number(match[1]) > 1) return true;
    return false;
  });
}

export async function generateMetadata(): Promise<Metadata> {
  const title = "Shop USA Gummies | Bundle & Save on American-Made Gummies";
  const description =
    "Explore USA Gummies bundles and best sellers. Made in the USA, all natural, dye-free. Free shipping on 5+ bags.";
  const canonical = `${SITE_URL}/shop`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function ShopPage(props: {
  searchParams: Promise<{
    sort?: string;
    q?: string;
    after?: string;
    before?: string;
  }>;
}) {
  const sp = await props.searchParams;
  const sort = coerceSort(sp.sort);
  const q = (sp.q ?? "").trim() || undefined;
  const after = sp.after || undefined;
  const before = sp.before || undefined;

  let results: Awaited<ReturnType<typeof getProductsPage>>;
  try {
    results = await getProductsPage({
      pageSize: PAGE_SIZE,
      sort,
      q,
      after,
      before,
    });
  } catch {
    results = {
      nodes: [],
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: null,
        endCursor: null,
      },
    } as any;
  }

  const primaryProduct = results.nodes?.[0] ?? null;
  const primaryHandle = primaryProduct?.handle || "all-american-gummy-bears-7-5-oz-single-bag";
  let detailedProduct: any = null;
  try {
    if (primaryProduct?.handle) {
      const detail = await getProductByHandle(primaryProduct.handle);
      detailedProduct = detail?.product || null;
    }
  } catch {
    detailedProduct = null;
  }

  const currency =
    detailedProduct?.priceRange?.minVariantPrice?.currencyCode ||
    primaryProduct?.priceRange?.minVariantPrice?.currencyCode ||
    "USD";

  const ladder = [1, 2, 3, 4, 5, 8, 12];
  const bundles = ladder.map((qty) => {
    const pricing = pricingForQty(qty);
    return {
      qty,
      total: pricing.total,
      perBag: pricing.perBag,
      id: `ladder-${qty}`,
      title: `${qty} Bag${qty > 1 ? "s" : ""}`,
    };
  });

  const mostPopular = bundles.find((b: any) => b.qty === 5) || bundles[Math.min(1, bundles.length - 1)];
  const bestValue =
    bundles
      .filter((b: any) => b.qty >= 8)
      .reduce((best: any, current: any) => {
        if (!best) return current;
        return current.perBag < best.perBag ? current : best;
      }, null) || bundles[bundles.length - 1];

  let bundleVariants: Awaited<ReturnType<typeof getBundleVariants>> | null = null;
  try {
    bundleVariants = await getBundleVariants();
  } catch {
    bundleVariants = null;
  }

  const quickBuyTiers = (bundleVariants?.variants || []).filter((t) =>
    [1, 2, 3, 4, 5, 8, 12].includes(t.quantity)
  );

  return (
    <main className="bg-[var(--bg)] py-8 sm:py-12 text-[var(--text)]">
      <div className="container mx-auto max-w-6xl px-4 space-y-10 sm:space-y-12">
        <section className="glass-card px-5 py-6 sm:px-8 sm:py-8 relative overflow-hidden">
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
            <div className="space-y-4">
              <div className="kicker">Shop USA Gummies</div>
              <div>
                <h1 className="text-3xl font-black text-[var(--text)] sm:text-4xl">Shop USA Gummies</h1>
                <p className="mt-2 text-sm font-semibold text-[var(--muted)]">
                  Made in the USA • All Natural • Dye-Free • {FREE_SHIPPING_PHRASE}
                </p>
              </div>
              <div className="badge-row">
                <span className="badge">🇺🇸 Made in USA</span>
                <span className="badge">🌿 All Natural</span>
                <span className="badge">✅ Dye-Free</span>
                <span className="badge badge--red">Bundle &amp; save</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/products/all-american-gummy-bears-7-5-oz-single-bag?focus=bundles" className="btn btn-red">
                  Build a bundle
                </Link>
                <Link href="#shop-catalog" className="btn btn-outline">
                  Shop flavors
                </Link>
              </div>
            </div>

            <BundleQuickBuy
              anchorId="shop-bundle-pricing"
              productHandle={primaryHandle}
              tiers={quickBuyTiers}
              singleBagVariantId={bundleVariants?.singleBagVariantId}
              availableForSale={bundleVariants?.availableForSale}
              variant="compact"
            />
          </div>
        </section>

        <section aria-label="Bundle ladder" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xl font-black text-[var(--text)]">Bundle savings ladder</div>
            <div className="text-sm font-semibold text-[var(--muted)]">Most popular: 5 bags · Best value: 8+ bags</div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {bundles.map((b: any) => {
              const isPopular = mostPopular && b.qty === mostPopular.qty;
              const isBest = bestValue && b.qty === bestValue.qty;
              const href = `/products/${primaryHandle}?focus=bundles&qty=${b.qty}`;
              const perBagText = money(b.perBag.toFixed(2), currency);
              const totalText = money(b.total.toFixed(2), currency);
              return (
                <article
                  key={b.id}
                  className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_18px_38px_rgba(15,27,45,0.12)] transition hover:-translate-y-1 hover:shadow-[0_24px_50px_rgba(15,27,45,0.16)]"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-base font-black text-[var(--text)]">{b.title || `${b.qty} Bags`}</div>
                    <div className="flex gap-2">
                      {isPopular ? (
                        <span className="badge badge--red text-[11px] font-bold">Most Popular</span>
                      ) : null}
                      {isBest ? (
                        <span className="badge badge--navy text-[11px] font-bold">Best Value</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2 text-2xl font-black text-[var(--text)]">{totalText}</div>
                  <div className="text-sm font-semibold text-[var(--muted)]">~ {perBagText} per bag</div>
                  {b.qty >= FREE_SHIP_QTY ? (
                    <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-[rgba(199,54,44,0.3)] bg-[rgba(199,54,44,0.12)] px-3 py-1 text-[11px] font-bold text-[var(--red)]">
                      {FREE_SHIPPING_PHRASE}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs font-semibold text-[var(--muted)]">{FREE_SHIPPING_PHRASE}</div>
                  )}
                  <div className="mt-4 grid gap-2">
                    <Link href={href} className="btn btn-navy justify-center">
                      Build bundle
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section id="shop-catalog" aria-label="Shop catalog" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="kicker">Shop by flavor</div>
              <h2 className="text-2xl font-black text-[var(--text)]">Shop the catalog</h2>
              <p className="text-sm text-[var(--muted)]">
                Browse best sellers, then jump into bundle pricing for the fastest checkout.
              </p>
            </div>
          </div>

          <div className="glass-card px-5 py-6 sm:px-6 sm:py-7">
            <ShopToolbar />
          </div>

          <div className="mt-4 grid gap-5 sm:gap-6 md:gap-7 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 justify-items-center">
            {results.nodes.map((p) => (
              <ShopProductCard key={p.id} product={p} hasBundle={hasBundleVariants(p)} />
            ))}
          </div>
        </section>

        <section className="mt-8 glass-card px-5 py-6 sm:px-6 sm:py-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-black text-[var(--text)]">You may also like</h2>
            <span className="text-sm font-semibold text-[var(--muted)]">More Americana drops coming soon</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Patriotic party pack",
                note: "Limited seasonal drops",
                img: "/home-patriotic-product.jpg",
                cta: "Coming soon",
              },
              {
                title: "Gift-ready bundle",
                note: "Easy host gifts",
                img: "/brand/hero.jpg",
                cta: "Join the waitlist",
              },
              {
                title: "USA Gummies merch",
                note: "Hats, stickers & more",
                img: "/america-250.jpg",
                cta: "Coming soon",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_12px_28px_rgba(15,27,45,0.12)]"
              >
                <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-strong)]">
                  <Image
                    src={item.img}
                    alt={item.title}
                    fill
                    sizes="(max-width: 768px) 90vw, 320px"
                    className="object-cover"
                  />
                </div>
                <div className="text-sm font-black text-[var(--text)]">{item.title}</div>
                <div className="mt-1 text-xs font-semibold text-[var(--muted)]">{item.note}</div>
                <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-1 text-[11px] font-bold text-[var(--text)]">
                  {item.cta}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-8 flex gap-3 flex-wrap">
          {results.pageInfo.hasPreviousPage && results.pageInfo.startCursor ? (
            <Link
              className="btn"
              href={{
                pathname: "/shop",
                query: {
                  sort,
                  ...(q ? { q } : {}),
                  before: results.pageInfo.startCursor,
                },
              }}
            >
              ← Prev
            </Link>
          ) : null}

          {results.pageInfo.hasNextPage && results.pageInfo.endCursor ? (
            <Link
              className="btn btn-navy"
              href={{
                pathname: "/shop",
                query: {
                  sort,
                  ...(q ? { q } : {}),
                  after: results.pageInfo.endCursor,
                },
              }}
            >
              Next →
            </Link>
          ) : null}
        </div>
      </div>
    </main>
  );
}
