// src/components/seo/BreadcrumbJsonLd.tsx
import { resolveSiteUrl } from "@/lib/seo/canonical";

type Crumb = {
  name: string;
  href: string; // must be a path like "/shop"
};

function absolute(href: string) {
  return new URL(href, resolveSiteUrl()).toString();
}

export function BreadcrumbJsonLd({ items }: { items: Crumb[] }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: item.name,
      item: absolute(item.href),
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
