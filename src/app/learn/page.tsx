import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { PageHero } from "@/components/lp/PageHero";
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
  },
  {
    href: "/no-artificial-dyes-gummy-bears",
    label: "Dye-free guide",
    description: "Why we skip artificial dyes and what we use instead.",
  },
  {
    href: "/gummies-101",
    label: "Gummies 101",
    description: "How gummies are made, textures, and flavor science.",
  },
  {
    href: "/ingredients",
    label: "Our ingredients",
    description: "Full ingredient list, allergen info, and sourcing details.",
  },
  {
    href: "/faq",
    label: "FAQ",
    description: "Answers to the most common questions about USA Gummies.",
  },
  {
    href: "/made-in-usa",
    label: "Made in USA",
    description: "Sourced, manufactured, and packed entirely in America.",
  },
];

export default function LearnPage() {
  const posts = getLearnPosts();

  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Learn", href: "/learn" },
        ]}
      />

      <PageHero
        eyebrow="Learn"
        headline="Guides &"
        scriptAccent="answers."
        sub="Guides, ingredients, FAQs, and everything you need to know about dye-free gummy bears made in the USA."
        ctas={[
          { href: "/blog", label: "Read the blog" },
          { href: "/shop", label: "Shop now", variant: "light" },
        ]}
      />

      {posts.length ? (
        <section className="bg-[var(--lp-cream)]">
          <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
            <div className="mb-10 text-center">
              <p className="lp-label mb-2 text-[var(--lp-red)]">★ Latest Articles ★</p>
              <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
                Fresh from
                <br />
                <span className="lp-script text-[var(--lp-red)]">the kitchen.</span>
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {posts.map((post, i) => (
                <Link
                  key={post.slug}
                  href={`/learn/${post.slug}`}
                  className="group block border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 no-underline"
                  style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
                >
                  <span className="lp-label inline-flex items-center bg-[var(--lp-red)] px-3 py-1 text-[var(--lp-off-white)]">
                    {post.category}
                  </span>
                  <h3 className="lp-display mt-4 text-[1.4rem] leading-tight text-[var(--lp-ink)] group-hover:text-[var(--lp-red)]">
                    {post.title}
                  </h3>
                  <p className="lp-sans mt-3 line-clamp-2 text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/82">
                    {post.description}
                  </p>
                  <div className="lp-label mt-5 flex items-center gap-x-3 text-[var(--lp-ink)]/65">
                    <span>{formatLearnDate(post.date)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{post.readingTime}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Quick Links ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
              Browse the
              <br />
              <span className="lp-script text-[var(--lp-red)]">basics.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {LEARN_LINKS.map((link, i) => (
              <Link
                key={link.href}
                href={link.href}
                className="group block border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 no-underline"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.3rem] leading-tight text-[var(--lp-ink)] group-hover:text-[var(--lp-red)]">
                  {link.label}
                </h3>
                <p className="lp-sans mt-3 text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/82">
                  {link.description}
                </p>
                <p className="lp-label mt-4 text-[var(--lp-red)]">Explore →</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Ready to Try? ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
            Dye-free
            <br />
            <span className="lp-script text-[var(--lp-red)]">gummy bears.</span>
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
