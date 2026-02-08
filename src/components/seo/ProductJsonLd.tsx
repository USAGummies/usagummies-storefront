type ProductJsonLdProps = {
  name: string;
  description?: string | null;
  handle: string;
  imageUrls?: Array<string | null | undefined> | null;
  imageUrl?: string | null;
  sku: string;
  currencyCode: string;
  priceAmount: string;
  brandName?: string;
  siteUrl: string;
  availability?: "InStock" | "OutOfStock";
  aggregateRating?: {
    ratingValue: number | string;
    reviewCount: number | string;
  } | null;
};

export function ProductJsonLd({
  name,
  description,
  handle,
  imageUrls,
  imageUrl,
  sku,
  currencyCode,
  priceAmount,
  brandName = "USA Gummies",
  siteUrl,
  availability = "InStock",
  aggregateRating,
}: ProductJsonLdProps) {
  const url = `${siteUrl}/products/${handle}`;
  const images = (imageUrls ?? (imageUrl ? [imageUrl] : []))
    .map((img) => (typeof img === "string" ? img : null))
    .filter(Boolean) as string[];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description: (description || "").slice(0, 5000) || undefined,
    image: images.length ? images : undefined,
    sku,
    brand: {
      "@type": "Brand",
      name: brandName,
    },
    url,
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: currencyCode,
      price: priceAmount,
      availability:
        availability === "OutOfStock"
          ? "https://schema.org/OutOfStock"
          : "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
    },
    ...(aggregateRating
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: aggregateRating.ratingValue,
            reviewCount: aggregateRating.reviewCount,
          },
        }
      : {}),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
