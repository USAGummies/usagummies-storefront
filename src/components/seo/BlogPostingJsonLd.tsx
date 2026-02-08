type BlogPostingJsonLdProps = {
  headline: string;
  description?: string | null;
  url: string;
  image?: string | string[] | null;
  datePublished: string;
  dateModified: string;
  authorName?: string;
  authorType?: "Person" | "Organization";
  publisherName?: string;
  publisherLogoUrl?: string | null;
};

export function BlogPostingJsonLd({
  headline,
  description,
  url,
  image,
  datePublished,
  dateModified,
  authorName = "USA Gummies",
  authorType = "Organization",
  publisherName = "USA Gummies",
  publisherLogoUrl,
}: BlogPostingJsonLdProps) {
  const images = Array.isArray(image) ? image : image ? [image] : [];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline,
    description: (description || "").slice(0, 5000) || undefined,
    url,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
    datePublished,
    dateModified,
    author: {
      "@type": authorType,
      name: authorName,
    },
    publisher: {
      "@type": "Organization",
      name: publisherName,
      logo: publisherLogoUrl
        ? {
            "@type": "ImageObject",
            url: publisherLogoUrl,
          }
        : undefined,
    },
    image: images.length ? images : undefined,
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
