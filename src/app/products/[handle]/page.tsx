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

export async function generateMetadata(props: { params: Promise<Params> }): Promise<Metadata> {
  const { handle } = await props.params;
  const data = await getProductByHandle(handle);
  const product = data?.product;
  if (!product) return {};

  const title = product.title;
  const description = product.description || "Premium American-made gummy bears. Fast shipping.";
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
    <main style={{ padding: "18px 0 60px" }}>
      <JsonLd data={jsonLd} />

      <div className="container">
        <div style={{ opacity: 0.78, fontSize: 13 }}>
          <Link href="/" style={{ color: "inherit", textDecoration: "none" }}>
            Home
          </Link>{" "}
          <span style={{ opacity: 0.45 }}>›</span>{" "}
          <Link href="/shop" style={{ color: "inherit", textDecoration: "none" }}>
            Shop
          </Link>{" "}
          <span style={{ opacity: 0.45 }}>›</span>{" "}
          <span style={{ fontWeight: 950 }}>{product.title}</span>
        </div>

        <div
          style={{
            marginTop: 14,
            display: "grid",
            gap: 14,
            gridTemplateColumns: "1.15fr 0.85fr",
          }}
          className="pdp-grid"
        >
          <div>
            <ProductGallery
              title={product.title}
              featured={product.featuredImage}
              images={images}
            />

            <div style={{ marginTop: 14 }}>
              <ProductTrustStack />
            </div>

            <div style={{ marginTop: 14 }}>
              <America250Blocks />
            </div>

            <div style={{ marginTop: 14 }}>
              <ReviewHighlights />
            </div>
          </div>

          <div>
            <div className="card" style={{ padding: 16 }}>
              <div className="kicker">USA Gummies</div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 950, fontSize: 34, lineHeight: 0.95, marginTop: 8 }}>
                {product.title}
              </div>
              {price ? (
                <div style={{ marginTop: 10, fontWeight: 950, fontSize: 18, opacity: 0.9 }}>
                  {price}
                </div>
              ) : null}
              <div style={{ marginTop: 10, opacity: 0.82, lineHeight: 1.6 }}>
                {product.description}
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <PurchaseBox product={purchaseProduct as any} focus={focus} />
            </div>
          </div>
        </div>

        <style>{`
          @media (max-width: 980px){
            .pdp-grid{ grid-template-columns: 1fr !important; }
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
