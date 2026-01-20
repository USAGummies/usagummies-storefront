import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { AmericanDreamCallout } from "@/components/story/AmericanDreamCallout";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { BRAND_STORY_HEADLINE, BRAND_STORY_MEDIUM } from "@/data/brandStory";

function resolveSiteUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || null;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : null;
  if (vercel) return vercel;
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return "https://www.usagummies.com";
}

const SITE_URL = resolveSiteUrl();
const PAGE_TITLE = "Made in USA Gummies | USA Gummies";
const PAGE_DESCRIPTION =
  "USA Gummies are All American gummy bears made in the USA. Learn how we source, make, and pack premium gummy bears.";
const OG_IMAGE = "/opengraph-image";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/made-in-usa` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/made-in-usa`,
    type: "website",
    images: [{ url: OG_IMAGE }],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

const VALUES = [
  {
    title: "Sourced, made, and packed in America",
    body:
      "USA Gummies are produced in the USA with a focus on quality, consistency, and a cleaner ingredient standard.",
  },
  {
    title: "All natural flavors, no artificial dyes",
    body:
      "Our gummy bears use all natural flavors and are colored with fruit and vegetable extracts. No artificial dyes.",
  },
  {
    title: "Built for everyday snacking",
    body:
      "Chewy, fruity, and smooth. A classic gummy bear flavor that feels premium and easy to share.",
  },
];

const articleJsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Made in USA gummies",
  description: PAGE_DESCRIPTION,
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": `${SITE_URL}/made-in-usa`,
  },
  author: {
    "@type": "Organization",
    name: "USA Gummies",
  },
  publisher: {
    "@type": "Organization",
    name: "USA Gummies",
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/brand/logo.png`,
    },
  },
  image: [`${SITE_URL}/brand/hero.jpg`],
};

export default function MadeInUsaPage() {
  return (
    <main className="relative overflow-hidden bg-[var(--bg)] text-[var(--text)] min-h-screen home-candy">
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(circle at 12% 18%, rgba(255,77,79,0.14), transparent 48%), radial-gradient(circle at 85% 5%, rgba(255,199,44,0.14), transparent 38%)",
            opacity: 0.5,
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-10">
          <BreadcrumbJsonLd
            items={[
              { name: "Home", href: "/" },
              { name: "Made in USA", href: "/made-in-usa" },
            ]}
          />

          <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
              <div className="space-y-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)]">
                  Made in the USA
                </div>
                <h1 className="text-3xl font-black leading-[1.1] tracking-tight text-[var(--text)] sm:text-4xl lg:text-5xl">
                  All American gummy bears, made right here.
                </h1>
                <p className="text-sm text-[var(--muted)] sm:text-base max-w-prose">
                  USA Gummies are built on American manufacturing and American pride. From sourcing
                  to packing, our gummy bears stay in the USA so every bag reflects the quality and
                  consistency you expect from a premium American candy brand.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link href="/shop" className="btn btn-candy">
                    Shop now and save
                  </Link>
                  <span className="text-xs text-[var(--muted)]">{FREE_SHIPPING_PHRASE}</span>
                </div>
              </div>

              <div className="relative">
                <div className="relative rounded-3xl border border-[var(--border)] bg-white p-2 text-[var(--text)] shadow-[0_20px_48px_rgba(15,27,45,0.12)]">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
                    <Image
                      src="/brand/hero.jpg"
                      alt="USA Gummies made in the USA"
                      fill
                      sizes="(max-width: 768px) 90vw, 460px"
                      className="object-cover"
                    />
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                      All American gummy bears
                    </div>
                    <div className="text-sm text-[var(--muted)]">
                      Made in the USA with all natural flavors and no artificial dyes.
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2">
                      <span className="badge badge--navy">Made in USA</span>
                      <span className="badge badge--navy">All natural flavors</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {VALUES.map((value) => (
                <div key={value.title} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    {value.title}
                  </div>
                  <div className="mt-2 text-sm text-[var(--muted)]">{value.body}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 candy-panel rounded-[32px] border border-[var(--border)] p-5 sm:p-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Our story
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              {BRAND_STORY_HEADLINE}
            </h2>
            <div className="mt-3 space-y-3 text-sm text-[var(--muted)]">
              {BRAND_STORY_MEDIUM.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/about" className="btn btn-outline">
                Read our story
              </Link>
              <Link href="/shop" className="btn btn-candy">
                Shop now and save
              </Link>
            </div>
          </div>

          <div className="mt-6">
            <AmericanDreamCallout variant="compact" ctaHref="/shop" ctaLabel="Choose a bag count" tone="light" />
          </div>

          <div className="mt-6 candy-panel rounded-[32px] border border-[var(--border)] p-5 sm:p-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Built for real life
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
              Support American jobs and snack with confidence.
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Every bag of USA Gummies is a vote for the America you believe in and the American
              Dream you are still chasing.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Link href="/about" className="btn btn-outline">
                Read our story
              </Link>
              <Link href="/ingredients" className="btn btn-candy">
                Ingredients and flavors
              </Link>
            </div>
          </div>
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
    </main>
  );
}
