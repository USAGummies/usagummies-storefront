import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { compileMDX } from "next-mdx-remote/rsc";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { PageHero } from "@/components/lp/PageHero";
import {
  getLearnPosts,
  getLearnPostBySlug,
  formatLearnDate,
} from "@/lib/learn";

export const revalidate = 3600;

type PageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return getLearnPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getLearnPostBySlug(slug);
  if (!post) return {};

  const title = post.seoTitle || post.title;
  const description = post.seoDescription || post.description;

  return {
    title,
    description,
    alternates: { canonical: `/learn/${post.slug}` },
    openGraph: {
      title: `${title} | USA Gummies`,
      description,
      url: `/learn/${post.slug}`,
      type: "article",
      publishedTime: post.date,
    },
  };
}

export default async function LearnPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = getLearnPostBySlug(slug);
  if (!post) {
    notFound();
  }

  const { content } = await compileMDX({
    source: post.content,
  });

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://www.usagummies.com";
  const pageUrl = `${siteUrl}/learn/${post.slug}`;

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.seoTitle || post.title,
    description: post.seoDescription || post.description,
    url: pageUrl,
    datePublished: post.date,
    author: {
      "@type": "Organization",
      name: post.author,
    },
    publisher: {
      "@type": "Organization",
      name: "USA Gummies",
      logo: {
        "@type": "ImageObject",
        url: `${siteUrl}/brand/logo.png`,
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": pageUrl,
    },
  };

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Learn", href: "/learn" },
          { name: post.title, href: `/learn/${post.slug}` },
        ]}
      />

      <section className="relative overflow-hidden">
        <div className="lp-bunting" aria-hidden />
        <div className="bg-[var(--lp-cream)]">
          <div className="mx-auto max-w-[900px] px-5 py-12 text-center sm:px-8 sm:py-16">
            <span className="lp-label inline-flex items-center bg-[var(--lp-red)] px-3 py-1.5 text-[var(--lp-off-white)]">
              {post.category}
            </span>

            <h1 className="lp-display mt-5 text-[clamp(2.2rem,6vw,4rem)] leading-[1.05] text-[var(--lp-ink)]">
              {post.title}
            </h1>

            <p className="lp-sans mx-auto mt-5 max-w-[60ch] text-[1.1rem] leading-[1.55] text-[var(--lp-ink)]/85">
              {post.description}
            </p>

            <div className="lp-label mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[var(--lp-ink)]/75">
              <span>{formatLearnDate(post.date)}</span>
              <span aria-hidden>·</span>
              <span>{post.readingTime}</span>
            </div>
          </div>
          <div className="lp-bunting-thin" aria-hidden />
        </div>
      </section>

      <article className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[800px] px-5 py-10 sm:px-8 sm:py-14">
          <div className="lp-sans prose prose-lg max-w-none text-[var(--lp-ink)] [&_h2]:lp-display [&_h2]:text-[var(--lp-ink)] [&_h2]:mt-10 [&_h3]:lp-display [&_h3]:text-[var(--lp-ink)] [&_h3]:mt-8 [&_a]:text-[var(--lp-red)] [&_a]:underline [&_a]:underline-offset-4 [&_strong]:text-[var(--lp-ink)] [&_blockquote]:border-l-[3px] [&_blockquote]:border-[var(--lp-red)] [&_blockquote]:pl-5 [&_blockquote]:italic [&_li]:my-2">
            {content}
          </div>
        </div>
      </article>

      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Ready to Try? ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
            Dye-free
            <br />
            <span className="lp-script text-[var(--lp-red)]">gummy bears.</span>
          </h2>
          <p className="lp-sans mx-auto mt-6 max-w-[52ch] text-[1rem] leading-[1.6] text-[var(--lp-ink)]/82">
            All American Gummy Bears &mdash; made in the USA with no artificial dyes.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/products/all-american-gummy-bears" className="lp-cta">
              Shop now
            </Link>
            <Link href="/learn" className="lp-cta lp-cta-light">
              More articles
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
