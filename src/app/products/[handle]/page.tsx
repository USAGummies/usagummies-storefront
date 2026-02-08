import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import BundleQuickBuy from "@/components/home/BundleQuickBuy.client";
import { BundleQuickBuyCtaProof } from "@/components/home/BundleQuickBuyProof";
import { ProductGallery } from "@/components/product/ProductGallery.client";
import { LazyStickyAddToCartBar } from "@/components/product/LazyStickyAddToCartBar.client";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { ProductJsonLd } from "@/components/seo/ProductJsonLd";
import FocusBundles from "./FocusBundles.client";
import { getBundleVariants } from "@/lib/bundles/getBundleVariants";
import { SINGLE_BAG_SKU } from "@/lib/bundles/atomic";
import { BASE_PRICE, FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { buildCanonicalUrl, resolveSiteUrl } from "@/lib/seo/canonical";
import { getProductByHandle } from "@/lib/storefront";
import { DETAIL_BULLETS } from "@/data/productDetails";

export const revalidate = 3600;

const OG_IMAGE = "/opengraph-image";
const PRODUCT_TITLE_FALLBACK = "Dye-Free Gummies Made in USA";
const PRODUCT_DESCRIPTION_FALLBACK =
  "Shop USA Gummies made in USA candy with no artificial dyes. Dye-free gummies for patriotic parties and gifts.";
const PRODUCT_TITLE_SUFFIX = " | Dye-Free Gummies Made in USA";
const PRODUCT_TITLE_MAX = 60;
const PRODUCT_DESCRIPTION_PREFIX = "Shop ";
const PRODUCT_DESCRIPTION_SUFFIX =
  ", a made in USA candy with no artificial dyes. Dye-free gummies for patriotic parties and gifts.";
const PRODUCT_DESCRIPTION_MAX = 155;

function clampText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength).trimEnd();
}

function buildProductTitle(name?: string | null) {
  if (!name) return PRODUCT_TITLE_FALLBACK;
  const maxName = PRODUCT_TITLE_MAX - PRODUCT_TITLE_SUFFIX.length;
  const safeName = clampText(name, Math.max(0, maxName));
  return `${safeName}${PRODUCT_TITLE_SUFFIX}`;
}

function buildProductDescription(name?: string | null) {
  if (!name) return PRODUCT_DESCRIPTION_FALLBACK;
  const maxName =
    PRODUCT_DESCRIPTION_MAX - PRODUCT_DESCRIPTION_PREFIX.length - PRODUCT_DESCRIPTION_SUFFIX.length;
  const safeName = clampText(name, Math.max(0, maxName));
  return `${PRODUCT_DESCRIPTION_PREFIX}${safeName}${PRODUCT_DESCRIPTION_SUFFIX}`;
}

type SearchParams = Record<string, string | string[] | undefined>;

type MetadataProps = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<SearchParams>;
};

type PageProps = {
  params: Promise<{ handle: string }>;
};

export async function generateMetadata({ params, searchParams }: MetadataProps): Promise<Metadata> {
  const { handle } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const siteUrl = resolveSiteUrl();
  const canonical = buildCanonicalUrl({
    pathname: `/products/${handle}`,
    searchParams: resolvedSearchParams,
    siteUrl,
  });

  let productTitle: string | null = null;
  let productDescription: string | null = null;
  let imageUrl: string | null = null;

  try {
    const detail = await getProductByHandle(handle);
    productTitle = detail?.product?.title ?? null;
    productDescription = detail?.product?.description ?? null;
    imageUrl = detail?.product?.featuredImage?.url ?? null;
  } catch {
    productTitle = null;
    productDescription = null;
    imageUrl = null;
  }

  const title = buildProductTitle(productTitle);
  const description = productDescription || buildProductDescription(productTitle);
  const ogImage = imageUrl || OG_IMAGE;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      images: [{ url: ogImage }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { handle } = await params;
  const detail = await getProductByHandle(handle);
  const product = detail?.product;

  if (!product) {
    notFound();
  }

  let bundleVariants: Awaited<ReturnType<typeof getBundleVariants>> | null = null;
  try {
    bundleVariants = await getBundleVariants();
  } catch {
    bundleVariants = null;
  }

  const bundleQuantities = [1, 2, 3, 4, 5, 8, 12];
  const tiers = (bundleVariants?.variants || []).filter((t) => bundleQuantities.includes(t.quantity));

  const productImages = (product.images?.edges || []).map((edge: any) => edge?.node).filter(Boolean);
  const productImageUrls = productImages.map((img: any) => img?.url).filter(Boolean);
  const stickyImage =
    product.featuredImage?.url || productImageUrls[0] || "/brand/usa-gummies-family.webp";
  const stickyAlt =
    product.featuredImage?.altText || (product.title ? `Product photo of ${product.title}` : "Product photo");
  const fallbackPrice =
    bundleVariants?.variants?.find((variant) => variant.quantity === 1)?.totalPrice ?? null;
  const priceAmount =
    product.priceRange?.minVariantPrice?.amount ||
    (fallbackPrice !== null ? fallbackPrice.toFixed(2) : BASE_PRICE.toFixed(2));
  const priceCurrency = product.priceRange?.minVariantPrice?.currencyCode || "USD";
  const productSku =
    product.variants?.edges
      ?.map((edge: any) => edge?.node)
      .find((variant: any) => variant?.sku)?.sku ||
    bundleVariants?.singleBagSku ||
    SINGLE_BAG_SKU;

  const summaryCopy = clampText(product.description || PRODUCT_DESCRIPTION_FALLBACK, 140);

  return (
    <main className="min-h-screen bg-white text-[var(--text)]">
      <FocusBundles targetSelector="#product-bundles" />

      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Shop", href: "/shop" },
          { name: product.title, href: `/products/${product.handle}` },
        ]}
      />

      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="atomic-buy">
          <div className="atomic-buy__glow" aria-hidden="true" />
          <div className="atomic-buy__header">
            <div className="atomic-buy__headerMain">
              <div className="atomic-buy__kicker">USA Gummies</div>
              <h1 className="atomic-buy__headerTitle">{product.title}</h1>
            </div>
            <div className="atomic-buy__headerSub">{summaryCopy}</div>
          </div>

          <div className="atomic-buy__grid">
            <div id="product-details" className="atomic-buy__details">
              <ul className="atomic-buy__bullets">
                {DETAIL_BULLETS.map((bullet) => (
                  <li key={bullet} className="atomic-buy__bullet">
                    <span className="atomic-buy__bulletDot" aria-hidden="true" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
              <div className="atomic-buy__chips">
                <span className="atomic-buy__chip">Made in USA</span>
                <span className="atomic-buy__chip">No artificial dyes</span>
                <span className="atomic-buy__chip">All natural</span>
                <span className="atomic-buy__chip">{FREE_SHIPPING_PHRASE}</span>
              </div>
              <div className="atomic-buy__ingredients">
                Ingredients &amp; allergen info: <Link href="/ingredients">ingredients</Link>. Guide:{" "}
                <Link href="/no-artificial-dyes-gummy-bears">No Artificial Dyes Gummy Bears</Link>.
              </div>
            </div>

            <div className="atomic-buy__media">
              <ProductGallery
                title={product.title}
                featured={product.featuredImage ?? null}
                images={productImages}
              />
            </div>

            <div id="product-bundles" className="atomic-buy__bundle">
              <BundleQuickBuy
                anchorId="product-bundles"
                productHandle={product.handle}
                tiers={tiers}
                singleBagVariantId={bundleVariants?.singleBagVariantId}
                availableForSale={bundleVariants?.availableForSale}
                tone="light"
                surface="flat"
                layout="classic"
                ctaProofSlot={
                  <BundleQuickBuyCtaProof tone="light" surface="flat" layout="classic" variant="default" />
                }
                selectorVariant="segmented"
              />
            </div>
          </div>
        </div>
      </section>

      <LazyStickyAddToCartBar
        title="In your cart"
        imageUrl={stickyImage}
        imageAlt={stickyAlt}
        buttonLabel="Buy now"
        source="shop"
        className="sm:hidden"
      />

      <ProductJsonLd
        name={product.title}
        description={product.description || PRODUCT_DESCRIPTION_FALLBACK}
        handle={product.handle}
        imageUrls={productImageUrls.length ? productImageUrls : [stickyImage]}
        sku={productSku}
        currencyCode={priceCurrency}
        priceAmount={priceAmount}
        brandName="USA Gummies"
        siteUrl={resolveSiteUrl()}
        availability={bundleVariants?.availableForSale === false ? "OutOfStock" : "InStock"}
      />
    </main>
  );
}
