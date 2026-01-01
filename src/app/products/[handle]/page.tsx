// src/app/products/[handle]/page.tsx (FULL REPLACE)
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { ProductGallery } from "@/components/product/ProductGallery.client";
import PurchaseBox from "./PurchaseBox.client";
import { StickyAddToCartBar } from "@/components/product/StickyAddToCartBar";
import { ProductTrustStack } from "@/components/product/ProductTrustStack";
import { America250Blocks } from "@/components/product/America250Blocks";
import { ReviewHighlights } from "@/components/reviews/ReviewHighlights";
import { getProductByHandle, money } from "@/lib/storefront";

type Params = { handle: string };

export async function generateMetadata(props: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { handle } = await props.params;
  const data = await getProductByHandle(handle);
  const product = data?.product;
  if (!product) return {};

  const title = product.title;
  const description =
    product.description || "Premium American-made gummy bears. Fast shipping.";
  const image = product.featuredImage?.url;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: image ? [{ url: image }] : undefined,
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

  const data = await getProductByHandle(handle);
  const product = data?.product;
  if (!product) return notFound();

  const variants = (product.variants?.edges ?? []).map((e: any) => e.node);
  const v0 = variants[0];

  const price = v0?.price?.amount
    ? money(v0.price.amount, v0.price.currencyCode)
    : "";

  const images = (product.images?.edges ?? []).map((e: any) => e.node);

  const purchaseProduct = {
    title: product.title,
    handle: product.handle,
    variants: { nodes: variants },
    priceRange: product.priceRange,
  };

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description,
    image: product.featuredImage?.url ? [product.featuredImage.url] : undefined,
    sku: v0?.id,
    brand: { "@type": "Brand", name: "USA Gummies" },
    offers: v0?.price?.amount
      ? {
          "@type": "Offer",
          priceCurrency: v0.price.currencyCode,
          price: v0.price.amount,
          availability: v0.availableForSale
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
          url: `/products/${product.handle}`,
        }
      : undefined,
  };

  return (
    <main className="pdp-root">
      <JsonLd data={jsonLd} />

      <div className="container">
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

            {/* On mobile, we want trust immediately after gallery */}
            <div className="pdp-mobile-only pdp-section">
              <ProductTrustStack />
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
              <div className="card pdp-titlecard">
                <div className="kicker">USA Gummies</div>

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
              <div className="card pdp-guarantee">
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

        <style>{`
          .pdp-root{
            padding: 18px 0 80px;
          }

          .pdp-breadcrumb{
            opacity: 0.82;
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
            padding: 18px;
          }

          .pdp-title{
            font-family: var(--font-display);
            font-weight: 950;
            font-size: 34px;
            line-height: 0.98;
            margin: 8px 0 0;
            letter-spacing: -0.02em;
          }

          .pdp-price{
            margin-top: 10px;
            font-weight: 950;
            font-size: 18px;
            opacity: 0.9;
          }

          .pdp-desc{
            margin-top: 10px;
            opacity: 0.84;
            line-height: 1.6;
          }

          .pdp-section{
            margin-top: 14px;
          }

          .pdp-mini-proof{
            margin-top: 12px;
          }

          .pdp-guarantee{
            padding: 14px 16px;
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
            .pdp-sticky{ position: static; }
            .pdp-desktop-only{ display: none; }
            .pdp-mobile-only{ display: block; }
            .pdp-section{ margin-top: 12px; }
            .pdp-title{ font-size: 30px; }
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
