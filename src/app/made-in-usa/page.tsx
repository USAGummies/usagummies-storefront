import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { AmericanDreamCallout } from "@/components/story/AmericanDreamCallout";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";

export const metadata: Metadata = {
  title: "Made in USA Gummies | USA Gummies",
  description:
    "USA Gummies are All American gummy bears made in the USA. Learn how we source, make, and pack premium gummy bears.",
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

export default function MadeInUsaPage() {
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
              { name: "Made in USA", href: "/made-in-usa" },
            ]}
          />

          <div className="metal-panel rounded-[36px] border border-white/12 p-6 sm:p-8 shadow-[0_32px_90px_rgba(7,12,20,0.55)]">
            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
              <div className="space-y-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/60">
                  Made in the USA
                </div>
                <h1 className="text-3xl font-black leading-[1.1] tracking-tight text-white sm:text-4xl lg:text-5xl">
                  All American gummy bears, made right here.
                </h1>
                <p className="text-sm text-white/80 sm:text-base max-w-prose">
                  USA Gummies are built on American manufacturing and American pride. From sourcing
                  to packing, our gummy bears stay in the USA so every bag reflects the quality and
                  consistency you expect from a premium American candy brand.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link href="/shop" className="btn btn-red">
                    Shop bundles
                  </Link>
                  <span className="text-xs text-white/70">{FREE_SHIPPING_PHRASE}</span>
                </div>
              </div>

              <div className="relative">
                <div className="relative rounded-3xl border border-white/20 bg-white/95 p-2 text-[var(--navy)] shadow-[0_26px_70px_rgba(7,12,20,0.35)]">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/60 bg-white">
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
                <div key={value.title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/60">
                    {value.title}
                  </div>
                  <div className="mt-2 text-sm text-white/75">{value.body}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <AmericanDreamCallout variant="compact" ctaHref="/shop" ctaLabel="Build a bundle" />
          </div>

          <div className="mt-6 metal-panel rounded-[32px] border border-white/12 p-5 sm:p-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
              Built for real life
            </div>
            <h2 className="mt-2 text-2xl font-black text-white">
              Support American jobs and snack with confidence.
            </h2>
            <p className="mt-2 text-sm text-white/75">
              Every bag of USA Gummies is a vote for the America you believe in and the American
              Dream you are still chasing.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Link href="/about" className="btn btn-outline-white">
                Read our story
              </Link>
              <Link href="/ingredients" className="btn btn-red">
                Ingredients and flavors
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
