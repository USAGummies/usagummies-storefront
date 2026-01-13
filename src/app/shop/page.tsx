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
import { AMAZON_LISTING_URL } from "@/lib/amazon";

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

  const focusQuantities = [5, 8, 12];
  const bundles = focusQuantities.map((qty) => {
    const pricing = pricingForQty(qty);
    return {
      qty,
      total: pricing.total,
      perBag: pricing.perBag,
      id: `ladder-${qty}`,
      title: `${qty} Bag${qty > 1 ? "s" : ""}`,
    };
  });

  const mostPopular = bundles.find((b: any) => b.qty === 5) || bundles[0];
  const bestValue = bundles.find((b: any) => b.qty === 8) || bundles[bundles.length - 1];
  const bestValuePerBagText = money(pricingForQty(8).perBag.toFixed(2), currency);

  let bundleVariants: Awaited<ReturnType<typeof getBundleVariants>> | null = null;
  try {
    bundleVariants = await getBundleVariants();
  } catch {
    bundleVariants = null;
  }

  const quickBuyTiers = (bundleVariants?.variants || []).filter((t) =>
    focusQuantities.includes(t.quantity)
  );

  return (
    <main className="relative overflow-hidden bg-[var(--navy)] text-white min-h-screen home-metal pb-16">
      <section
        className="relative overflow-hidden bg-[var(--navy)] text-white hero-parallax"
        style={{
          backgroundImage:
            "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 45%, rgba(255,255,255,0) 100%), radial-gradient(circle at 12% 18%, rgba(199,54,44,0.22), rgba(255,255,255,0) 38%), radial-gradient(circle at 85% 0%, rgba(255,255,255,0.08), rgba(255,255,255,0) 30%)",
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.08), transparent 45%), radial-gradient(circle at 80% 0%, rgba(255,255,255,0.06), transparent 40%)",
            opacity: 0.4,
          }}
        />
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[rgba(199,54,44,0.28)] blur-3xl" aria-hidden="true" />
        <div className="absolute -left-20 bottom-0 h-72 w-72 rounded-full bg-white/10 blur-3xl" aria-hidden="true" />

        <div className="relative mx-auto max-w-6xl px-4 py-10 lg:py-12">
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.32em] text-white/70 sm:text-xs">
                <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1">Made in the USA</span>
                <span className="text-[var(--gold)]">No artificial dyes</span>
              </div>

              <div className="space-y-2">
                <h1 className="text-4xl font-black leading-[1.05] tracking-tight text-white sm:text-5xl">
                  Shop USA Gummies
                </h1>
                <p className="text-sm text-white/80 sm:text-base max-w-prose">
                  USA Gummies – All American Gummy Bears, 7.5 oz, Made in USA, No Artificial Dyes,
                  All Natural Flavors.
                </p>
              </div>

              <div className="grid gap-2 text-sm text-white/75">
                <div className="flex items-start gap-2">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-[var(--gold)]" />
                  <span>
                    MADE IN THE USA – Proudly sourced, manufactured, and packed entirely in America.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-[rgba(199,54,44,0.8)]" />
                  <span>
                    NO ARTIFICIAL DYES OR SYNTHETIC COLORS – Colored naturally using real fruit and vegetable extracts.
                  </span>
                </div>
                <div className="flex items-start gap-2 text-white/70">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-white/50" />
                  <span>
                    CLASSIC GUMMY BEAR FLAVOR — DONE RIGHT – All the chewy, fruity flavor you expect, without artificial ingredients or harsh aftertaste.
                  </span>
                </div>
              </div>

              <div className="text-xs text-white/65">
                7.5 oz bag with 5 fruit flavors: Cherry, Watermelon, Orange, Green Apple, and Lemon.
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <a href="#bundle-pricing" className="btn btn-red">
                  Build my bundle
                </a>
                <a
                  href={AMAZON_LISTING_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline-white"
                >
                  Buy 1-3 bags on Amazon
                </a>
                <span className="text-xs text-white/70">{FREE_SHIPPING_PHRASE}</span>
              </div>

              <div className="metal-panel rounded-3xl border border-white/12 p-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-white/60">Best value</div>
                    <div className="text-base font-black text-white">8 bags</div>
                    <div className="text-[11px] text-white/70">~ {bestValuePerBagText} / bag</div>
                  </div>
                  <div className="space-y-1 sm:border-l sm:border-white/10 sm:pl-4">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-white/60">Free shipping</div>
                    <div className="text-base font-black text-white">5+ bags</div>
                    <div className="text-[11px] text-white/70">{FREE_SHIPPING_PHRASE}</div>
                  </div>
                  <div className="space-y-1 sm:border-l sm:border-white/10 sm:pl-4">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-white/60">No artificial dyes</div>
                    <div className="text-base font-black text-white">All natural flavors</div>
                    <div className="text-[11px] text-white/70">Colored with fruit + vegetable extracts</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="metal-panel rounded-[36px] border border-[rgba(199,54,44,0.45)] p-3 ring-1 ring-white/20 shadow-[0_32px_90px_rgba(7,12,20,0.6)]">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
                  <span>Build your bundle</span>
                  <span className="text-[var(--gold)]">5 / 8 / 12 bags</span>
                </div>
                <div className="mt-1 text-xs text-white/70">
                  Tap a bundle size to lock your price.
                </div>
                <div className="mt-3 space-y-3">
                  <div
                    id="bundle-pricing"
                    className="bundle-home metal-panel rounded-[28px] border border-[rgba(199,160,98,0.4)] p-2 shadow-[0_22px_60px_rgba(7,12,20,0.6)]"
                  >
                    <BundleQuickBuy
                      anchorId="bundle-pricing"
                      productHandle={primaryHandle}
                      tiers={quickBuyTiers}
                      singleBagVariantId={bundleVariants?.singleBagVariantId}
                      availableForSale={bundleVariants?.availableForSale}
                      variant="compact"
                    />
                  </div>

                  <div className="relative">
                    <div className="absolute -top-6 right-6 h-20 w-20 rounded-full bg-[rgba(199,54,44,0.25)] blur-2xl" aria-hidden="true" />
                    <div className="relative rounded-3xl border border-white/20 bg-white/95 p-2 text-[var(--navy)] shadow-[0_30px_70px_rgba(7,12,20,0.35)]">
                      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/60 bg-white">
                        <Image
                          src="/home-patriotic-product.jpg"
                          alt="USA Gummies bundle"
                          fill
                          sizes="(max-width: 640px) 90vw, (max-width: 1024px) 60vw, 520px"
                          className="object-cover"
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 via-black/0 to-transparent p-3">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/80">
                            Best seller
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 space-y-1">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                          Best seller
                        </div>
                        <div className="text-lg font-black text-[var(--navy)]">
                          USA Gummies - All American Gummy Bears
                        </div>
                        <div className="text-sm text-[var(--muted)]">
                          7.5 oz bag with 5 fruit flavors
                        </div>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <span className="badge badge--navy">Made in USA</span>
                          <span className="badge badge--navy">No artificial dyes</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section aria-label="Bundle sizes" className="bg-[var(--navy)]">
        <div className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
          <div className="metal-panel rounded-[36px] border border-[rgba(199,54,44,0.25)] p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
                  Bundle sizes
                </div>
                <h2 className="mt-2 text-2xl font-black text-white">
                  Pick your bundle size.
                </h2>
                <p className="mt-2 text-sm text-white/70">
                  Bundle pricing lowers the per-bag cost. {FREE_SHIPPING_PHRASE}.
                </p>
              </div>
              <a
                href={AMAZON_LISTING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-outline-white"
              >
                Buy 1-3 bags on Amazon
              </a>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {bundles.map((b: any) => {
                const isPopular = mostPopular && b.qty === mostPopular.qty;
                const isBest = bestValue && b.qty === bestValue.qty;
                const href = `/products/${primaryHandle}?focus=bundles&qty=${b.qty}`;
                const perBagText = money(b.perBag.toFixed(2), currency);
                const totalText = money(b.total.toFixed(2), currency);
                return (
                  <article
                    key={b.id}
                    className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-[0_18px_42px_rgba(7,12,20,0.35)] transition hover:-translate-y-1 hover:shadow-[0_26px_60px_rgba(7,12,20,0.45)]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-base font-black text-white">{b.title || `${b.qty} Bags`}</div>
                      <div className="flex gap-2">
                        {isPopular ? (
                          <span className="badge badge--inverse text-[11px] font-bold">Most Popular</span>
                        ) : null}
                        {isBest ? (
                          <span className="badge badge--inverse text-[11px] font-bold">Best Value</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-2 text-2xl font-black text-white">{totalText}</div>
                    <div className="text-sm font-semibold text-white/70">~ {perBagText} per bag</div>
                    {b.qty >= FREE_SHIP_QTY ? (
                      <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-[rgba(199,54,44,0.35)] bg-[rgba(199,54,44,0.18)] px-3 py-1 text-[11px] font-bold text-white/90">
                        {FREE_SHIPPING_PHRASE}
                      </div>
                    ) : (
                      <div className="mt-2 text-xs font-semibold text-white/60">{FREE_SHIPPING_PHRASE}</div>
                    )}
                    <div className="mt-4 grid gap-2">
                      <Link href={href} className="btn btn-red justify-center">
                        Build bundle
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section id="shop-catalog" aria-label="Shop catalog" className="bg-[var(--navy)]">
        <div className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
                Shop catalog
              </div>
              <h2 className="text-2xl font-black text-white">Shop the catalog</h2>
              <p className="text-sm text-white/70">
                Great for lunchboxes, desk drawers, road trips, care packages, and guilt-free sweet cravings.
              </p>
            </div>
          </div>

          <div className="mt-4 metal-panel rounded-[32px] border border-white/12 p-5 sm:p-6">
            <ShopToolbar />
          </div>

          <div className="mt-5 grid gap-5 sm:gap-6 md:gap-7 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 justify-items-center">
            {results.nodes.map((p) => (
              <ShopProductCard key={p.id} product={p} hasBundle={hasBundleVariants(p)} />
            ))}
          </div>

          <div className="mt-6 metal-panel rounded-[32px] border border-white/12 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
                  Also on Amazon
                </div>
                <div className="mt-2 text-lg font-black text-white">
                  USA Gummies – All American Gummy Bears, 7.5 oz, Made in USA, No Artificial Dyes, All Natural Flavors.
                </div>
              </div>
              <a
                href={AMAZON_LISTING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-outline-white"
              >
                View Amazon listing
              </a>
            </div>
          </div>

          <div className="mt-6 flex gap-3 flex-wrap">
            {results.pageInfo.hasPreviousPage && results.pageInfo.startCursor ? (
              <Link
                className="btn btn-outline-white"
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
                className="btn btn-red"
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
      </section>
    </main>
  );
}
