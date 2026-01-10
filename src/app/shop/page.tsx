// src/app/shop/page.tsx (FULL REPLACE)
import type { Metadata } from "next";
import Link from "next/link";
import { ShopToolbar } from "@/components/shop/ShopToolbar";
import { ShopProductCard } from "@/components/shop/ShopProductCard";
import { getProductsPage, type SortValue } from "@/lib/shopify/products";
import { getProductByHandle, money } from "@/lib/storefront";
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

  const ladder = [1, 4, 5, 8, 12];
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

  return (
    <main className="bg-[var(--bg)] py-8 sm:py-12 text-[var(--text)]">
      <div className="container mx-auto max-w-6xl px-4 space-y-8 sm:space-y-10">
        <div className="glass-card px-5 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
            <div>
              <h1 className="text-3xl font-black text-[var(--text)] sm:text-4xl">Shop USA Gummies</h1>
              <p className="mt-1 text-sm font-semibold text-[var(--muted)]">
                Made in the USA • All Natural • Dye-Free • {FREE_SHIPPING_PHRASE}
              </p>
            </div>
            <Link href="/products/all-american-gummy-bears-7-5-oz-single-bag?focus=bundles" className="btn btn-navy">
              Build a bundle
            </Link>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="badge">🇺🇸 Made in USA</span>
            <span className="badge">🌿 All Natural</span>
            <span className="badge">✅ Dye-Free</span>
            <span className="badge badge--red">Bundle &amp; save</span>
            <span className="text-sm font-semibold text-[var(--muted)]">
              {FREE_SHIPPING_PHRASE}
            </span>
          </div>

          <div className="mt-6">
            <ShopToolbar />
          </div>
        </div>

        <section aria-label="Bundles" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xl font-black text-[var(--text)]">Pick your bundle</div>
            <div className="text-sm font-semibold text-[var(--muted)]">Most popular: 5 bags · Best value: 8+ bags</div>
          </div>
          <div className="grid grid-cols-1 justify-items-center gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {bundles.map((b: any) => {
              const isPopular = mostPopular && b.qty === mostPopular.qty;
              const isBest = bestValue && b.qty === bestValue.qty;
              const href = `/products/${primaryHandle}?focus=bundles&qty=${b.qty}`;
              const perBagText = money(b.perBag.toFixed(2), currency);
              const totalText = money(b.total.toFixed(2), currency);
              return (
                <article
                  key={b.id}
                  className="glass-card w-full max-w-[340px] rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
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
                  <div className="mt-2 text-xl font-black text-[var(--text)]">{totalText}</div>
                  <div className="text-sm font-semibold text-[var(--muted)]">~ {perBagText} per bag</div>
                  {b.qty >= FREE_SHIP_QTY ? (
                    <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-[rgba(205,53,50,0.4)] bg-[rgba(205,53,50,0.12)] px-3 py-1 text-[11px] font-bold text-[var(--red)]">
                      {FREE_SHIPPING_PHRASE}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs font-semibold text-[var(--muted)]">{FREE_SHIPPING_PHRASE}</div>
                  )}
                  <div className="mt-4 grid gap-2">
                    <Link href={href} className="btn btn-red justify-center">
                      Select bundle
                    </Link>
                    <Link href={`/products/${primaryHandle}?focus=bundles`} className="btn btn-outline justify-center">
                      View details
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <div className="mt-4 grid gap-5 sm:gap-6 md:gap-7 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 justify-items-center">
          {results.nodes.map((p) => (
            <ShopProductCard key={p.id} product={p} hasBundle={hasBundleVariants(p)} />
          ))}
        </div>

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
