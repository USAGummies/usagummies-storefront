import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { compileMDX } from "next-mdx-remote/rsc";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
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
    <main className="min-h-screen bg-[var(--surface-strong)] text-[var(--text)]">
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

      {/* ── HERO ── */}
      <section className="relative flex min-h-[300px] items-center justify-center overflow-hidden bg-[#1B2A4A] sm:min-h-[360px]">
        <Image
          src="/brand/americana/declaration-freedom.jpg"
          alt="USA Gummies brand background"
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#1B2A4A]/60 to-[#1B2A4A]/80" />
        <div className="relative z-10 flex flex-col items-center gap-4 px-4 text-center">
          <Image
            src="/brand/logo-full.png"
            alt="USA Gummies logo"
            width={200}
            height={128}
            className="h-auto w-[140px] sm:w-[180px]"
          />
          <span className="inline-block rounded-full bg-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white">
            {post.category}
          </span>
          <h1 className="font-display max-w-2xl text-3xl font-black text-white sm:text-4xl lg:text-5xl">
            {post.title}
          </h1>
          <div className="flex items-center gap-3 text-sm text-white/70">
            <span>{formatLearnDate(post.date)}</span>
            <span aria-hidden="true">&middot;</span>
            <span>{post.readingTime}</span>
          </div>
        </div>
      </section>

      {/* ── ARTICLE CONTENT ── */}
      <article className="mx-auto max-w-3xl px-4 py-12">
        <div className="prose prose-lg prose-slate mx-auto max-w-none prose-headings:font-black prose-a:text-[#c7362c] prose-a:no-underline hover:prose-a:underline">
          {content}
        </div>
      </article>

      {/* ── CTA ── */}
      <section className="mx-auto max-w-3xl px-4 pb-16">
        <div className="rounded-2xl border border-[rgba(15,27,45,0.1)] bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-black text-[var(--text)]">
            Ready to try dye-free gummy bears?
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            All American Gummy Bears &mdash; made in the USA with no artificial
            dyes.
          </p>
          <Link
            href="/products/all-american-gummy-bears"
            className="mt-4 inline-block rounded-full bg-[#c7362c] px-6 py-3 text-sm font-bold text-white transition hover:bg-[#a82d25]"
          >
            Shop Now
          </Link>
        </div>
      </section>
    </main>
  );
}
