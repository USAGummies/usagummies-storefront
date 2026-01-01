// src/components/seo/BreadcrumbJsonLd.tsx
type Crumb = {
  name: string;
  href: string; // must be a path like "/shop"
};

function siteUrl() {
  return process.env.NODE_ENV === "production"
    ? "https://www.usagummies.com"
    : "http://localhost:3000";
}

function absolute(href: string) {
  return new URL(href, siteUrl()).toString();
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
