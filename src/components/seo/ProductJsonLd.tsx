type ProductJsonLdProps = {
  name: string;
  description?: string | null;
  handle: string;
  imageUrl?: string | null;
  currencyCode: string;
  priceAmount: string;
  brandName?: string;
  siteUrl: string;
  availability?: "InStock" | "OutOfStock";
};

export function ProductJsonLd({
  name,
  description,
  handle,
  imageUrl,
  currencyCode,
  priceAmount,
  brandName = "USA Gummies",
  siteUrl,
  availability = "InStock",
}: ProductJsonLdProps) {
  const url = `${siteUrl}/products/${handle}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description: (description || "").slice(0, 5000) || undefined,
    image: imageUrl ? [imageUrl] : undefined,
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
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
