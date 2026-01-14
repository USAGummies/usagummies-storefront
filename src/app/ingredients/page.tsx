import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { AMAZON_LISTING_URL } from "@/lib/amazon";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";

export const metadata: Metadata = {
  title: "Ingredients & Flavor Notes | USA Gummies",
  description:
    "Ingredients and flavor notes for USA Gummies. All American gummy bears with all natural flavors and no artificial dyes or synthetic colors.",
};

const FLAVORS = [
  {
    name: "Cherry",
    notes: "Bright, classic cherry with a clean, fruit-forward finish.",
  },
  {
    name: "Watermelon",
    notes: "Smooth and refreshing, a light summer watermelon note.",
  },
  {
    name: "Orange",
    notes: "Citrus pop with a sweet, familiar orange flavor.",
  },
  {
    name: "Green apple",
    notes: "Crisp green apple with a balanced sweet-tart bite.",
  },
  {
    name: "Lemon",
    notes: "Zesty lemon lift that keeps the chew bright and clean.",
  },
];

const QUALITY_POINTS = [
  {
    title: "All natural flavors",
    body:
      "USA Gummies use all natural flavors for a classic gummy bear taste that stays smooth and balanced.",
  },
  {
    title: "No artificial dyes or synthetic colors",
    body:
      "Color comes from real fruit and vegetable extracts. No artificial dyes, no synthetic colors.",
  },
  {
    title: "Made in the USA",
    body:
      "Sourced, made, and packed right here in America with tight quality control at every step.",
  },
];

export default function IngredientsPage() {
  return (
    <main className="relative overflow-hidden bg-[var(--navy)] text-white min-h-screen home-metal">
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(circle at 12% 18%, rgba(199,54,44,0.2), transparent 45%), radial-gradient(circle at 85% 5%, rgba(255,255,255,0.08), transparent 35%)",
            opacity: 0.6,
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-10">
          <BreadcrumbJsonLd
            items={[
              { name: "Home", href: "/" },
              { name: "Ingredients", href: "/ingredients" },
            ]}
          />

          <div className="metal-panel rounded-[36px] border border-white/12 p-6 sm:p-8 shadow-[0_32px_90px_rgba(7,12,20,0.55)]">
            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
              <div className="space-y-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/60">
                  Ingredients and flavor notes
                </div>
                <h1 className="text-3xl font-black leading-[1.1] tracking-tight text-white sm:text-4xl lg:text-5xl">
                  Clean ingredients. Classic gummy bear flavor.
                </h1>
                <p className="text-sm text-white/80 sm:text-base max-w-prose">
                  USA Gummies are All American gummy bears with all natural flavors, no artificial
                  dyes, and a clean, chewy finish. Each 7.5 oz bag includes five fruit flavors that
                  keep the taste bright without a harsh aftertaste.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link href="/shop" className="btn btn-red">
                    Shop bundles
                  </Link>
                  <a
                    href={AMAZON_LISTING_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline-white"
                  >
                    Buy 1-3 bags on Amazon
                  </a>
                  <span className="text-xs text-white/70">{FREE_SHIPPING_PHRASE}</span>
                </div>
              </div>

              <div className="relative">
                <div className="relative rounded-3xl border border-white/20 bg-white/95 p-2 text-[var(--navy)] shadow-[0_26px_70px_rgba(7,12,20,0.35)]">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/60 bg-white">
                    <Image
                      src="/home-patriotic-product.jpg"
                      alt="USA Gummies All American gummy bears"
                      fill
                      sizes="(max-width: 768px) 90vw, 460px"
                      className="object-cover"
                    />
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                      7.5 oz bag with 5 fruit flavors
                    </div>
                    <div className="text-sm text-[var(--muted)]">
                      Cherry, watermelon, orange, green apple, and lemon.
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2">
                      <span className="badge badge--navy">No artificial dyes</span>
                      <span className="badge badge--navy">All natural flavors</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {QUALITY_POINTS.map((point) => (
                <div key={point.title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/60">
                    {point.title}
                  </div>
                  <div className="mt-2 text-sm text-white/75">{point.body}</div>
                </div>
              ))}
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {FLAVORS.map((flavor) => (
                <div
                  key={flavor.name}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="text-sm font-semibold text-white">{flavor.name}</div>
                  <div className="mt-2 text-sm text-white/75">{flavor.notes}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 metal-panel rounded-[32px] border border-white/12 p-5 sm:p-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
              Ingredient details
            </div>
            <h2 className="mt-2 text-2xl font-black text-white">Check the label for full details.</h2>
            <p className="mt-2 text-sm text-white/75">
              For full ingredient and allergen details, please review the ingredient panel on the bag
              or the Amazon listing before you order.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Link href="/faq" className="btn btn-outline-white">
                Read FAQ
              </Link>
              <a
                href={AMAZON_LISTING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-red"
              >
                View Amazon listing
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
