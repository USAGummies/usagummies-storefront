import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";

export const metadata: Metadata = {
  title: "About USA Gummies | All Natural, Dye-Free, Made in the USA",
  description:
    "USA Gummies makes premium gummy bears with all natural flavors, no artificial dyes, and proud U.S. manufacturing. Bundle pricing is built in. Free shipping on 5+ bags.",
};

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/80">
      {children}
    </span>
  );
}

export default function AboutPage() {
  return (
    <main className="min-h-screen text-white">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <BreadcrumbJsonLd
          items={[
            { name: "Home", href: "/" },
            { name: "About", href: "/about" },
          ]}
        />

        <div className="glass p-8">
          <div className="flex flex-wrap items-center gap-2">
            <Pill>
              <span className="font-semibold text-white">All natural</span>
            </Pill>
            <Pill>No artificial dyes</Pill>
            <Pill>Made in USA</Pill>
          </div>

          <h1 className="mt-5 text-4xl font-semibold tracking-tight">
            Built for people who read labels.
          </h1>

          <p className="mt-4 max-w-3xl text-lg text-white/75">
            USA Gummies exists for a simple reason: candy should taste incredible
            without looking like a science experiment.
            <span className="text-white"> </span>
            We make gummy bears with <span className="text-white font-semibold">all natural flavors</span>,
            <span className="text-white font-semibold"> no artificial dyes</span>, and
            <span className="text-white font-semibold"> proud U.S. manufacturing</span>.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="glass-soft p-5">
              <div className="text-sm font-semibold">No artificial dyes</div>
              <div className="mt-1 text-sm text-white/70">
                Cleaner ingredients. Cleaner finish. Built for people who care what goes in.
              </div>
            </div>

            <div className="glass-soft p-5">
              <div className="text-sm font-semibold">All natural flavors</div>
              <div className="mt-1 text-sm text-white/70">
                Great taste without the fake, neon vibe. Simple, premium, shareable.
              </div>
            </div>

            <div className="glass-soft p-5">
              <div className="text-sm font-semibold">Made in the USA</div>
              <div className="mt-1 text-sm text-white/70">
                Manufactured and shipped from the United States — fast, reliable fulfillment.
              </div>
            </div>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">
                Founder-led, quality-first
              </div>
              <h2 className="text-2xl font-semibold">American-made candy, done right.</h2>
              <p className="text-white/75">
                USA Gummies started with a simple goal: make gummy bears that taste
                incredible and feel good to share — without the artificial dyes.
                We keep production close, ingredients clean, and quality consistent.
              </p>
              <div className="flex flex-wrap gap-2 text-xs text-white/70">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                  Made in America
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                  Small-batch care
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                  Clean ingredients
                </span>
              </div>
            </div>

            <div className="glass-soft p-4">
              <div className="aspect-[4/3] overflow-hidden rounded-3xl border border-white/10 bg-white/5">
                <Image
                  src="/brand/hero.jpg"
                  alt="USA Gummies made in the USA"
                  width={1200}
                  height={900}
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
          </div>

          <div className="mt-8 grid gap-8 md:grid-cols-2 md:items-center">
            <div>
              <h2 className="text-2xl font-semibold">Crafted in America</h2>
              <p className="mt-3 text-white/75">
                USA Gummies are made in the United States with clean ingredients and
                real fruit-forward flavor. No artificial dyes. No weird aftertaste.
              </p>
              <p className="mt-3 text-white/75">
                We keep the process simple: quality ingredients, consistent texture,
                and a bag that’s ready for everyday snacking or gifting.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/shop"
                  className="inline-flex items-center justify-center rounded-2xl bg-white px-6 py-3 text-sm font-semibold text-black hover:bg-white/90"
                >
                  Shop bundles →
                </Link>
                <Link
                  href="/contact"
                  className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10"
                >
                  Contact
                </Link>
              </div>
            </div>

            <div className="glass-soft p-4">
              <div className="aspect-[4/3] overflow-hidden rounded-3xl border border-white/10 bg-white/5">
                <Image
                  src="/home-patriotic-product.jpg"
                  alt="USA Gummies — all natural flavors, no artificial dyes, made in the USA"
                  width={1200}
                  height={900}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Pill>All natural</Pill>
                <Pill>No artificial dyes</Pill>
                <Pill>Made in USA</Pill>
              </div>
            </div>
          </div>
        </div>

        <div className="h-10" />
      </div>
    </main>
  );
}
