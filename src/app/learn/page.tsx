import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { getLearnPosts, formatLearnDate } from "@/lib/learn";

export const metadata: Metadata = {
  title: "Learn About Dye-Free Gummies",
  description:
    "Explore guides on dye-free candy, ingredients, how gummies are made, and why USA Gummies uses no artificial dyes.",
  alternates: { canonical: "https://www.usagummies.com/learn" },
  openGraph: {
    title: "Learn About Dye-Free Gummies | USA Gummies",
    description:
      "Explore guides on dye-free candy, ingredients, how gummies are made, and why USA Gummies uses no artificial dyes.",
    url: "https://www.usagummies.com/learn",
    type: "website",
  },
};

const LEARN_LINKS = [
  {
    href: "/blog",
    label: "Read our blog",
    description: "Behind-the-scenes stories, recipes, and candy news.",
    icon: "📝",
  },
  {
    href: "/no-artificial-dyes-gummy-bears",
    label: "Dye-free guide",
    description: "Why we skip artificial dyes and what we use instead.",
    icon: "🌿",
  },
  {
    href: "/gummies-101",
    label: "Gummies 101",
    description: "How gummies are made, textures, and flavor science.",
    icon: "🍬",
  },
  {
    href: "/ingredients",
    label: "Our ingredients",
    description: "Full ingredient list, allergen info, and sourcing details.",
    icon: "📋",
  },
  {
    href: "/faq",
    label: "FAQ",
    description: "Answers to the most common questions about USA Gummies.",
    icon: "❓",
  },
  {
    href: "/made-in-usa",
    label: "Made in USA",
    description: "Sourced, manufactured, and packed entirely in America.",
    icon: "🇺🇸",
  },
];

function LearnPostsSection() {
  const posts = getLearnPosts();
  if (!posts.length) return null;

  return (
    <section className="mx-auto max-w-4xl px-4 pt-12 pb-8">
      <h2 className="mb-6 text-center text-2xl font-black text-[var(--text)]">
        Latest Articles
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {posts.map((post) => (
          <Link
            key={post.slug}
            href={`/learn/${post.slug}`}
            className="group flex flex-col gap-2 rounded-2xl border border-[rgba(15,27,45,0.1)] bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
          >
            <span className="inline-block self-start rounded-full bg-[#1B2A4A]/10 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-[#1B2A4A]">
              {post.category}
            </span>
            <span className="text-base font-black text-[var(--text)] group-hover:text-[#c7362c]">
              {post.title}
            </span>
            <span className="line-clamp-2 text-sm text-[var(--muted)]">
              {post.description}
            </span>
            <span className="mt-auto flex items-center gap-2 pt-2 text-xs text-[var(--muted)]">
              <span>{formatLearnDate(post.date)}</span>
              <span aria-hidden="true">&middot;</span>
              <span>{post.readingTime}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function LearnPage() {
  return (
    <main className="min-h-screen bg-[var(--surface-strong)] text-[var(--text)]">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Learn", href: "/learn" },
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
          <h1 className="font-display text-3xl font-black text-white sm:text-4xl lg:text-5xl">
            Learn
          </h1>
          <p className="max-w-md text-sm text-white/80 sm:text-base">
            Guides, ingredients, FAQs, and everything you need to know about
            dye-free gummy bears made in the USA.
          </p>
        </div>
      </section>

      {/* ── LEARN POSTS ── */}
      <LearnPostsSection />

      {/* ── LOGO DIVIDER ── */}
      <div
        className="flex items-center justify-center gap-4 py-6 bg-[var(--surface-strong)]"
        aria-hidden="true"
      >
        <div className="h-px flex-1 max-w-[120px] bg-[#1B2A4A]/10" />
        <Image
          src="/brand/logo.png"
          alt=""
          aria-hidden="true"
          width={48}
          height={16}
          className="h-3 w-auto opacity-30"
        />
        <div className="h-px flex-1 max-w-[120px] bg-[#1B2A4A]/10" />
      </div>

      {/* ── LINK GRID ── */}
      <section className="mx-auto max-w-4xl px-4 pb-16">
        <h2 className="mb-6 text-center text-2xl font-black text-[var(--text)]">
          Quick Links
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LEARN_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group flex flex-col gap-3 rounded-2xl border border-[rgba(15,27,45,0.1)] bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
            >
              <span className="text-2xl" aria-hidden="true">
                {link.icon}
              </span>
              <span className="text-base font-black text-[var(--text)] group-hover:text-[#c7362c]">
                {link.label}
              </span>
              <span className="text-sm text-[var(--muted)]">
                {link.description}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
