import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { buildCanonicalUrl, resolveSiteUrl } from "@/lib/seo/canonical";
import { getCollectionByHandle } from "@/lib/shopify/collections";

export const revalidate = 3600;

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  params: Promise<{ handle: string }>;
  searchParams?: Promise<SearchParams>;
};

function formatMoney(amount?: string, currency = "USD") {
  if (!amount) return null;
  const value = Number(amount);
  if (!Number.isFinite(value)) return amount;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { handle } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const siteUrl = resolveSiteUrl();
  const canonical = buildCanonicalUrl({
    pathname: `/collections/${handle}`,
    searchParams: resolvedSearchParams,
    siteUrl,
  });

  const collection = await getCollectionByHandle(handle);
  if (!collection) return { alternates: { canonical } };

  const title = collection.seo?.title || collection.title;
  const description =
    collection.seo?.description ||
    collection.description ||
    "Explore USA Gummies collections and bundle savings.";

  const ogImage = collection.image?.url || `${siteUrl}/opengraph-image`;

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

export default async function CollectionPage({ params }: PageProps) {
  const { handle } = await params;
  const siteUrl = resolveSiteUrl();
  const collection = await getCollectionByHandle(handle);
  if (!collection) {
    notFound();
  }

  const products = collection.products?.nodes ?? [];

  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: collection.title,
    description:
      collection.description || "Explore USA Gummies collections and bundle savings.",
    url: `${siteUrl}/collections/${handle}`,
    publisher: { "@id": `${siteUrl}#organization` },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: products.map((product, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${siteUrl}/products/${product.handle}`,
        name: product.title,
      })),
    },
  };

  return (
    <main className="min-h-screen bg-white text-[var(--text)]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
      />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Shop", href: "/shop" },
          { name: collection.title, href: `/collections/${handle}` },
        ]}
      />

      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Collection
            </div>
            <h1 className="mt-2 text-3xl font-black text-[var(--text)]">
              {collection.title}
            </h1>
            {collection.description ? (
              <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
                {collection.description}
              </p>
            ) : null}
          </div>

          {collection.image?.url ? (
            <div className="w-full max-w-sm">
              <div className="media-frame">
                <div className="relative aspect-square w-full">
                  <Image
                    src={collection.image.url}
                    alt={collection.image.altText || `${collection.title} collection image`}
                    fill
                    sizes="(max-width: 768px) 100vw, 320px"
                    className="object-cover"
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {products.length ? (
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => {
              const price = product.priceRange?.minVariantPrice;
              const priceText = price ? formatMoney(price.amount, price.currencyCode) : null;
              return (
                <Link
                  key={product.id}
                  href={`/products/${product.handle}`}
                  className="related-product-card"
                >
                  <span className="related-product-card__media">
                    <span className="related-product-card__imageFrame">
                      {product.featuredImage?.url ? (
                        <Image
                          src={product.featuredImage.url}
                          alt={
                            product.featuredImage.altText ||
                            (product.title ? `Product photo of ${product.title}` : "Product photo")
                          }
                          fill
                          sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 280px"
                          className="related-product-card__image"
                        />
                      ) : (
                        <span className="related-product-card__imageFallback">No image</span>
                      )}
                    </span>
                  </span>
                  <span className="related-product-card__body">
                    <span className="related-product-card__eyebrow">USA Gummies</span>
                    <span className="related-product-card__title">{product.title}</span>
                    <span className="related-product-card__price">
                      {priceText ? (
                        <>
                          Starting at <span className="related-product-card__priceValue">{priceText}</span>
                        </>
                      ) : (
                        "See pricing"
                      )}
                    </span>
                    <span className="related-product-card__tags">
                      <span className="badge">Made in USA</span>
                      <span className="badge">Dye-free</span>
                    </span>
                    <span className="related-product-card__cta">
                      <span className="btn btn-candy">View product</span>
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="mt-10 rounded-3xl border border-[var(--border)] bg-[var(--surface-strong)] p-6 text-sm text-[var(--muted)]">
            No products are available in this collection yet.
          </div>
        )}
      </section>
    </main>
  );
}
