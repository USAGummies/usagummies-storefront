import type { Metadata } from "next";
import Link from "next/link";
import { PageHero } from "@/components/lp/PageHero";
import { GuideCard } from "@/components/internal-links/GuideCard";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { getPillarGuides } from "@/lib/guides";
import { resolveSiteUrl } from "@/lib/seo/canonical";

const SITE_URL = resolveSiteUrl();

export const metadata: Metadata = {
  title: "Guides | USA Gummies",
  description:
    "USA Gummies guides on made in USA candy, dye-free gummies, gifting, and bundle planning.",
  alternates: { canonical: `${SITE_URL}/guides` },
  openGraph: {
    title: "Guides | USA Gummies",
    description:
      "USA Gummies guides on made in USA candy, dye-free gummies, gifting, and bundle planning.",
    url: `${SITE_URL}/guides`,
    type: "website",
    images: [{ url: "/opengraph-image" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Guides | USA Gummies",
    description:
      "USA Gummies guides on made in USA candy, dye-free gummies, gifting, and bundle planning.",
    images: ["/opengraph-image"],
  },
};

export default function GuidesIndexPage() {
  const guides = getPillarGuides();
  const topGuides = guides.slice(0, 3);

  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Guides", href: "/guides" },
        ]}
      />

      <PageHero
        eyebrow="Guides"
        headline="USA Gummies"
        scriptAccent="guides."
        sub="Made in USA candy knowledge, dye-free tips, gifting ideas, and bundle planning help."
        ctas={
          topGuides.length
            ? [{ href: `/guides/${topGuides[0].slug}`, label: topGuides[0].title }]
            : undefined
        }
      />

      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
          {topGuides.length ? (
            <div className="mb-10 flex flex-wrap justify-center gap-3">
              {topGuides.map((guide) => (
                <Link
                  key={guide.slug}
                  href={`/guides/${guide.slug}`}
                  className="lp-label inline-flex items-center border-2 border-[var(--lp-ink)] bg-[var(--lp-off-white)] px-3 py-1.5 text-[var(--lp-ink)] no-underline hover:bg-[var(--lp-ink)] hover:text-[var(--lp-cream)]"
                >
                  {guide.title}
                </Link>
              ))}
            </div>
          ) : null}

          {guides.length ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {guides.map((guide) => (
                <GuideCard
                  key={guide.slug}
                  guide={{ ...guide, href: `/guides/${guide.slug}` }}
                />
              ))}
            </div>
          ) : (
            <div className="lp-sans py-10 text-center text-[1.05rem] text-[var(--lp-ink)]/75">
              New guides are on the way.
            </div>
          )}
        </div>
      </section>

      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Ready to Order? ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            Skip the research.
            <br />
            <span className="lp-script text-[var(--lp-red)]">grab a bag.</span>
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop" className="lp-cta">
              Shop USA Gummies
            </Link>
            <Link href="/blog" className="lp-cta lp-cta-light">
              Read the blog
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
