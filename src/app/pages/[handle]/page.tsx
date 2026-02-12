import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { buildCanonicalUrl, resolveSiteUrl } from "@/lib/seo/canonical";
import { getPageByHandle } from "@/lib/shopify/pages";

export const revalidate = 3600;

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  params: Promise<{ handle: string }>;
  searchParams?: Promise<SearchParams>;
};

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { handle } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const siteUrl = resolveSiteUrl();
  const canonical = buildCanonicalUrl({
    pathname: `/pages/${handle}`,
    searchParams: resolvedSearchParams,
    siteUrl,
  });

  const page = await getPageByHandle(handle);
  if (!page) return { alternates: { canonical } };

  const title = page.seo?.title || page.title;
  const description =
    page.seo?.description ||
    page.bodySummary ||
    `Learn more about ${page.title}.`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      images: [{ url: `${siteUrl}/opengraph-image` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${siteUrl}/opengraph-image`],
    },
  };
}

export default async function ShopifyPage({ params }: PageProps) {
  const { handle } = await params;
  const siteUrl = resolveSiteUrl();
  const page = await getPageByHandle(handle);
  if (!page) {
    notFound();
  }

  const webPageJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: page.seo?.title || page.title,
    description:
      page.seo?.description || page.bodySummary || `Learn more about ${page.title}.`,
    url: `${siteUrl}/pages/${handle}`,
    isPartOf: {
      "@type": "WebSite",
      name: "USA Gummies",
      url: siteUrl,
    },
  };

  return (
    <main className="min-h-screen bg-white text-[var(--text)]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageJsonLd) }}
      />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: page.title, href: `/pages/${handle}` },
        ]}
      />

      <section className="mx-auto max-w-3xl px-4 py-12">
        <div className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
          USA Gummies
        </div>
        <h1 className="mt-2 text-3xl font-black text-[var(--text)]">{page.title}</h1>
        {page.body ? (
          <div
            className="mt-6 text-sm leading-relaxed text-[var(--muted)]"
            dangerouslySetInnerHTML={{ __html: page.body }}
          />
        ) : (
          <p className="mt-6 text-sm text-[var(--muted)]">Content coming soon.</p>
        )}
      </section>
    </main>
  );
}
