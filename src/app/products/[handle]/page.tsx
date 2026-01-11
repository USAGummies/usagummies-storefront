// src/app/products/[handle]/page.tsx (FULL REPLACE)
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { JsonLd } from "@/components/JsonLd";
import { ProductGallery } from "@/components/product/ProductGallery.client";
import PurchaseBox from "./PurchaseBox.client";
import { StickyAddToCartBar } from "@/components/product/StickyAddToCartBar";
import { ProductTrustStack } from "@/components/product/ProductTrustStack";
import { America250Blocks } from "@/components/product/America250Blocks";
import { ReviewHighlights } from "@/components/reviews/ReviewHighlights";
import { getProductByHandle, money } from "@/lib/storefront";

type Params = { handle: string };

function resolveSiteUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : null;
  if (vercel) return vercel;
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return "https://www.usagummies.com";
}

const SITE_URL = resolveSiteUrl();

function extractPriceRange(pr?: {
  minVariantPrice?: { amount?: string; currencyCode?: string };
  maxVariantPrice?: { amount?: string; currencyCode?: string };
}) {
  const min = pr?.minVariantPrice;
  const max = pr?.maxVariantPrice;
  const minAmount = min?.amount;
  const maxAmount = max?.amount;
  const currency = min?.currencyCode || max?.currencyCode;

  return {
    min: minAmount && currency ? { amount: minAmount, currencyCode: currency } : undefined,
    max: maxAmount && currency ? { amount: maxAmount, currencyCode: currency } : undefined,
  };
}

function validateProductJsonLd(data: any) {
  if (process.env.NODE_ENV === "production") return;
  try {
    const offers = data?.offers;
    if (!offers) return;
    const errs: string[] = [];

    const checkOffer = (offer: any, label: string) => {
      if (!offer?.priceCurrency) errs.push(`${label}: missing priceCurrency`);
      if (offer?.url && typeof offer.url === "string" && !offer.url.startsWith("http")) {
        errs.push(`${label}: url not absolute`);
      }
      if (offer?.lowPrice && Number.isNaN(Number(offer.lowPrice))) {
        errs.push(`${label}: lowPrice not a number`);
      }
      if (offer?.highPrice && Number.isNaN(Number(offer.highPrice))) {
        errs.push(`${label}: highPrice not a number`);
      }
      if (offer?.price && Number.isNaN(Number(offer.price))) {
        errs.push(`${label}: price not a number`);
      }
    };

    if (Array.isArray(offers)) {
      offers.forEach((o, idx) => checkOffer(o, `offer[${idx}]`));
    } else {
      checkOffer(offers, "offers");
    }

    if (errs.length) {
      // eslint-disable-next-line no-console
      console.warn("[SEO JSON-LD validation]", errs);
    }
  } catch {
    // ignore in dev validation
  }
}

export async function generateMetadata(props: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { handle } = await props.params;
  let data: Awaited<ReturnType<typeof getProductByHandle>> | null = null;
  try {
    data = await getProductByHandle(handle);
  } catch {
    data = null;
  }

  const product = data?.product;
  const canonical = `${SITE_URL}/products/${handle}`;

  if (!product) {
    const fallbackTitle = "USA Gummies | Product";
    const fallbackDescription = "Premium American-made gummy bears. Fast shipping.";
    return {
      title: fallbackTitle,
      description: fallbackDescription,
      alternates: { canonical },
      openGraph: {
        title: fallbackTitle,
        description: fallbackDescription,
        url: canonical,
      },
      twitter: {
        card: "summary_large_image",
        title: fallbackTitle,
        description: fallbackDescription,
      },
    };
  }

  const title = product.title;
  const description =
    product.description || "Premium American-made gummy bears. Fast shipping.";
  const image = product.featuredImage?.url;

  return {
    title,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      url: canonical,
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function ProductPage(props: {
  params: Promise<Params>;
  searchParams?: Promise<{ focus?: string }>;
}) {
  const { handle } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const focus = sp.focus;

  let data: Awaited<ReturnType<typeof getProductByHandle>> | null = null;
  try {
    data = await getProductByHandle(handle);
  } catch {
    data = null;
  }
  const product = data?.product;

  if (!product) {
    return (
      <main className="pdp-root">
        <div className="container pdp-container">
          <div className="glass-card p-6 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
              USA Gummies
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-[var(--text)]">Product is temporarily unavailable</h1>
            <p className="text-sm text-[var(--muted)]">
              We could not load this product from Shopify right now. Please try again in a moment or shop bundles instead.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href="/shop" className="btn btn-red pressable">
                Shop bundles
              </Link>
              <Link href="/" className="btn pressable">
                Go home
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const variants = (product.variants?.edges ?? []).map((e: any) => e.node);
  const v0 = variants[0];

  const price = v0?.price?.amount
    ? money(v0.price.amount, v0.price.currencyCode)
    : "";

  const images = (product.images?.edges ?? []).map((e: any) => e.node);
  const macroShots = images.length ? images.slice(0, 4) : [];

  const purchaseProduct = {
    title: product.title,
    handle: product.handle,
    description: product.description,
    variants: { nodes: variants },
    priceRange: product.priceRange,
  };

  const priceRange = extractPriceRange(product?.priceRange);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description,
    image: product.featuredImage?.url ? [product.featuredImage.url] : undefined,
    sku: v0?.id,
    brand: { "@type": "Brand", name: "USA Gummies" },
    offers: (() => {
      const minPrice = priceRange.min;
      const maxPrice = priceRange.max;
      const anyAvailable = variants.some((v: any) => v.availableForSale);
      const availability = anyAvailable
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock";

      if (minPrice?.amount && maxPrice?.amount) {
        return {
          "@type": "AggregateOffer",
          priceCurrency: minPrice.currencyCode,
          lowPrice: minPrice.amount,
          highPrice: maxPrice.amount,
          availability,
          url: `${SITE_URL}/products/${product.handle}`,
          itemCondition: "https://schema.org/NewCondition",
        };
      }

      if (v0?.price?.amount) {
        return {
          "@type": "Offer",
          priceCurrency: v0.price.currencyCode,
          price: v0.price.amount,
          availability,
          url: `${SITE_URL}/products/${product.handle}`,
          itemCondition: "https://schema.org/NewCondition",
        };
      }

      return undefined;
    })(),
  };
  validateProductJsonLd(jsonLd);

  return (
    <main className="pdp-root">
      <JsonLd data={jsonLd} />

      <div className="container pdp-container">
        {/* Breadcrumb */}
        <div className="pdp-breadcrumb">
          <Link href="/" className="pdp-crumb">
            Home
          </Link>
          <span className="pdp-sep">›</span>
          <Link href="/shop" className="pdp-crumb">
            Shop
          </Link>
          <span className="pdp-sep">›</span>
          <span className="pdp-crumb-current">{product.title}</span>
        </div>

        {/* Main grid */}
        <div className="pdp-grid">
          {/* LEFT: Gallery + content */}
          <section className="pdp-left">
            <ProductGallery
              title={product.title}
              featured={product.featuredImage}
              images={images}
            />

            {macroShots.length ? (
              <div className="pdp-section pdp-macro">
                <div className="pdp-sectionTitle">Gummy close-ups</div>
                <div className="pdp-macroGrid">
                  {macroShots.map((img: any, idx: number) => (
                    <div key={img?.url || idx} className="pdp-macroCard">
                      {img?.url ? (
                        <Image
                          src={img.url}
                          alt={img.altText || "USA Gummies close-up"}
                          fill
                          className="object-cover"
                          sizes="(max-width: 768px) 50vw, 200px"
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* On mobile, we want trust immediately after gallery */}
            <div className="pdp-mobile-only pdp-section">
              <ProductTrustStack />
            </div>

            <div className="pdp-section pdp-accordions">
              <div className="pdp-sectionTitle">Details & transparency</div>
              <details className="pdp-accordion" open>
                <summary>Description</summary>
                <div className="pdp-accordionBody">
                  {product.description || "Premium gummy bears made in the USA with clean ingredients."}
                </div>
              </details>
              <details className="pdp-accordion">
                <summary>Ingredients</summary>
                <div className="pdp-accordionBody">
                  All-natural flavors with no artificial dyes. See the bag for full ingredient details.
                </div>
              </details>
              <details className="pdp-accordion">
                <summary>Nutrition</summary>
                <div className="pdp-accordionBody">
                  Nutrition facts are listed on the package. Scan the bag for full panel details.
                </div>
              </details>
              <details className="pdp-accordion">
                <summary>FAQ</summary>
                <div className="pdp-accordionBody">
                  <ul>
                    <li>Made in the USA with clean ingredients.</li>
                    <li>{`Free shipping on 5+ bags.`}</li>
                    <li>Bundle discounts scale automatically as you add bags.</li>
                  </ul>
                </div>
              </details>
            </div>

            <div className="pdp-section">
              <America250Blocks productTitle={product.title} />
            </div>

            <div className="pdp-section">
              <ReviewHighlights />
            </div>
          </section>

          {/* RIGHT: Sticky purchase column */}
          <aside className="pdp-right">
            <div className="pdp-sticky">
              <div className="glass-card pdp-titlecard">
                <div className="pdp-kicker">USA Gummies</div>

                <h1 className="pdp-title">{product.title}</h1>

                {price ? <div className="pdp-price">{price}</div> : null}

                {/* Desktop trust near the decision point */}
                <div className="pdp-desktop-only pdp-mini-proof">
                  <ProductTrustStack />
                </div>

                <div className="pdp-desc">{product.description}</div>
              </div>

              <div className="pdp-section">
                <PurchaseBox product={purchaseProduct as any} focus={focus} />
              </div>

              {/* Micro-proof + CTA reassurance under purchase */}
              <div className="glass-card pdp-guarantee">
                <div className="pdp-guarantee-title">🇺🇸 The USA Gummies promise</div>
                <ul className="pdp-guarantee-list">
                  <li>Fast shipping, packed with care</li>
                  <li>Real American-made gummy bears</li>
                  <li>Easy checkout through Shopify</li>
                </ul>
              </div>
            </div>
          </aside>
        </div>

        <section className="pdp-section pdp-crosssell">
          <div className="pdp-sectionTitle">You may also like</div>
          <div className="pdp-crosssellGrid">
            {[
              {
                title: "Patriotic party pack",
                note: "Limited seasonal drops",
                img: "/home-patriotic-product.jpg",
                cta: "Coming soon",
              },
              {
                title: "Gift-ready bundle",
                note: "Perfect for hosts",
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
              <div key={item.title} className="glass-card pdp-crosssellCard">
                <div className="pdp-crosssellMedia">
                  <Image
                    src={item.img}
                    alt={item.title}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 90vw, 280px"
                  />
                </div>
                <div className="pdp-crosssellTitle">{item.title}</div>
                <div className="pdp-crosssellNote">{item.note}</div>
                <div className="pdp-crosssellCta">{item.cta}</div>
              </div>
            ))}
          </div>
        </section>

        <style>{`
          .pdp-root{
            padding: 18px 0 80px;
            color: var(--text);
          }

          .pdp-container{
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 16px;
          }

          .pdp-breadcrumb{
            color: var(--muted);
            font-size: 13px;
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
          }
          .pdp-crumb{
            color: inherit;
            text-decoration: none;
          }
          .pdp-crumb:hover{
            text-decoration: underline;
          }
          .pdp-sep{ opacity: 0.45; }
          .pdp-crumb-current{
            font-weight: 950;
            opacity: 0.95;
          }

          .pdp-grid{
            margin-top: 16px;
            display: grid;
            gap: 16px;
            grid-template-columns: minmax(0, 1fr) 420px;
            align-items: start;
          }

          .pdp-left{ min-width: 0; }
          .pdp-right{ min-width: 0; }

          .pdp-sticky{
            position: sticky;
            top: 16px;
            display: grid;
            gap: 14px;
          }

          .pdp-titlecard{
            padding: 20px;
            border: 1px solid var(--border);
            background: var(--surface);
          }

          .pdp-kicker{
            display:inline-flex;
            align-items:center;
            gap:6px;
            padding:4px 8px;
            border-radius:999px;
            border:1px solid var(--border);
            font-size:11px;
            letter-spacing:0.08em;
            text-transform:uppercase;
            color: var(--muted);
            background: var(--surface-strong);
          }

          .pdp-title{
            font-family: var(--font-display);
            font-weight: 950;
            font-size: 32px;
            line-height: 1.08;
            margin: 8px 0 0;
            letter-spacing: -0.015em;
            color: var(--text);
          }

          .pdp-price{
            margin-top: 10px;
            font-weight: 950;
            font-size: 18px;
            color: var(--navy);
          }

          .pdp-desc{
            margin-top: 10px;
            opacity: 0.88;
            line-height: 1.6;
            border-top: 1px solid var(--border);
            padding-top: 10px;
            max-width: 640px;
            color: var(--muted);
          }

          .pdp-section{
            margin-top: 14px;
          }

          .pdp-sectionTitle{
            font-weight: 950;
            font-size: 16px;
            margin-bottom: 8px;
          }

          .pdp-macroGrid{
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }
          .pdp-macroCard{
            position: relative;
            aspect-ratio: 1 / 1;
            border-radius: 14px;
            overflow: hidden;
            border: 1px solid var(--border);
            background: var(--surface-strong);
            box-shadow: 0 16px 36px rgba(15,27,45,0.12);
          }

          .pdp-accordions{
            display: grid;
            gap: 10px;
          }
          .pdp-accordion{
            border-radius: 14px;
            border: 1px solid var(--border);
            background: var(--surface-strong);
            padding: 10px 12px;
          }
          .pdp-accordion summary{
            cursor: pointer;
            font-weight: 800;
            color: var(--text);
            list-style: none;
          }
          .pdp-accordion summary::-webkit-details-marker{ display:none; }
          .pdp-accordionBody{
            margin-top: 6px;
            color: var(--muted);
            font-size: 13px;
            line-height: 1.6;
          }
          .pdp-accordionBody ul{
            padding-left: 18px;
            margin: 6px 0 0;
          }

          .pdp-crosssellGrid{
            display: grid;
            gap: 10px;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          }
          .pdp-crosssellCard{
            padding: 14px;
            border: 1px solid var(--border);
            background: var(--surface);
            box-shadow: 0 14px 30px rgba(15,27,45,0.1);
          }
          .pdp-crosssellMedia{
            position: relative;
            aspect-ratio: 4 / 3;
            border-radius: 14px;
            overflow: hidden;
            border: 1px solid var(--border);
            background: var(--surface-strong);
            margin-bottom: 10px;
          }
          .pdp-crosssellTitle{
            font-weight: 900;
            margin-bottom: 6px;
          }
          .pdp-crosssellNote{
            font-size: 13px;
            color: var(--muted);
          }
          .pdp-crosssellCta{
            margin-top: 10px;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            border-radius: 999px;
            border: 1px solid var(--border);
            background: var(--surface-strong);
            padding: 6px 10px;
            font-size: 11px;
            font-weight: 900;
            color: var(--text);
          }

          .pdp-mini-proof{
            margin-top: 12px;
          }

          .pdp-guarantee{
            padding: 14px 16px;
            border: 1px solid var(--border);
            background: var(--surface);
          }
          .pdp-guarantee-title{
            font-weight: 950;
            margin-bottom: 8px;
          }
          .pdp-guarantee-list{
            margin: 0;
            padding-left: 18px;
            opacity: 0.88;
            line-height: 1.6;
            font-size: 14px;
          }

          .pdp-desktop-only{ display: block; }
          .pdp-mobile-only{ display: none; }

          @media (max-width: 1100px){
            .pdp-grid{ grid-template-columns: minmax(0,1fr) 380px; }
          }

          @media (max-width: 980px){
            .pdp-root{ padding: 14px 0 90px; }
            .pdp-grid{ grid-template-columns: 1fr; }
            .pdp-right{ order: 1; }
            .pdp-left{ order: 2; }
            .pdp-sticky{ position: static; }
            .pdp-desktop-only{ display: none; }
            .pdp-mobile-only{ display: block; }
            .pdp-section{ margin-top: 12px; }
            .pdp-title{ font-size: 30px; }
            .pdp-macroGrid{ grid-template-columns: repeat(2, minmax(0,1fr)); }
          }
        `}</style>
      </div>

      {/* Sticky CTA for mobile */}
      <StickyAddToCartBar
        title={product.title}
        priceText={price || ""}
        imageUrl={product.featuredImage?.url}
        imageAlt={product.featuredImage?.altText}
      />
    </main>
  );
}
