import type { Metadata } from "next";
import Link from "next/link";
import { GuideCard } from "@/components/internal-links/GuideCard";
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
    <main className="blog-shell">
      <section className="blog-hero">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
            Guides
          </div>
          <h1 className="blog-title">USA Gummies guides</h1>
          <p className="blog-subtitle">
            Made in USA candy knowledge, dye-free tips, gifting ideas, and bundle planning help.
          </p>
        </div>

        {topGuides.length ? (
          <div className="flex flex-wrap gap-2">
            {topGuides.map((guide) => (
              <Link key={guide.slug} href={`/guides/${guide.slug}`} className="btn btn-outline btn-compact">
                {guide.title}
              </Link>
            ))}
          </div>
        ) : null}
      </section>

      {guides.length ? (
        <div className="blog-grid">
          {guides.map((guide) => (
            <GuideCard key={guide.slug} guide={{ ...guide, href: `/guides/${guide.slug}` }} />
          ))}
        </div>
      ) : (
        <div className="blog-empty">New guides are on the way.</div>
      )}
    </main>
  );
}
