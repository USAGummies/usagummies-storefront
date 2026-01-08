// src/app/thank-you/page.tsx
import Link from "next/link";
import Image from "next/image";
import { Reveal } from "@/components/ui/Reveal";

const igImages = ["/home-patriotic-product.jpg", "/brand/hero.jpg", "/hero.jpg"];

export default function ThankYouPage() {
  return (
    <main className="pb-16">
      <div className="mx-auto max-w-6xl px-4 pt-10">
        <Reveal className="glass-card p-6 space-y-3">
          <div className="text-xs font-semibold tracking-[0.22em] text-[var(--muted)] uppercase">
            USA Gummies
          </div>
          <h1 className="text-3xl font-black text-white leading-tight">
            You’re officially part of the movement 🇺🇸
          </h1>
          <div className="text-sm font-semibold text-[var(--muted)]">
            Made in USA • All Natural • No Artificial Dyes
          </div>
        </Reveal>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Reveal className="glass-card p-5 space-y-3">
            <div className="text-lg font-black text-white">America 250 perks</div>
            <ul className="list-disc list-inside text-sm text-[var(--muted)] space-y-1">
              <li>Early drops</li>
              <li>Bundle deals</li>
              <li>First access to new runs</li>
            </ul>
            <Link
              href="/america-250"
              className="btn btn-red pressable inline-flex w-fit"
            >
              Claim America 250 perks
            </Link>
          </Reveal>

          <Reveal className="glass-card p-5 space-y-3">
            <div className="text-lg font-black text-white">Follow @usagummies</div>
            <div className="grid grid-cols-3 gap-2">
              {igImages.map((src) => (
                <div key={src} className="relative aspect-square overflow-hidden rounded-xl border border-[var(--border)]">
                  <Image src={src} alt="USA Gummies social" fill className="object-cover" />
                </div>
              ))}
            </div>
            <Link
              href="https://www.instagram.com/usagummies"
              className="btn btn-navy pressable inline-flex w-fit"
            >
              Follow @usagummies
            </Link>
          </Reveal>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Reveal className="glass-card p-5 space-y-3">
            <div className="text-lg font-black text-white">Stay in the circle</div>
            <div className="text-sm text-[var(--muted)]">No spam. Only bold flavor news.</div>
            <form className="flex flex-wrap gap-2">
              <input type="hidden" name="source" value="thank-you" />
              <input
                type="email"
                name="email"
                placeholder="Your email"
                className="usa-input flex-1 min-w-[220px]"
                aria-label="Email"
                required
              />
              <button type="submit" className="btn btn-navy pressable px-4 py-2">
                Get first access
              </button>
            </form>
          </Reveal>

          <Reveal className="glass-card p-5 space-y-3">
            <div className="text-lg font-black text-white">Build your next bundle</div>
            <div className="text-sm text-[var(--muted)]">
              Free shipping at 5+ bags. Most customers go bigger on the next run.
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/shop" className="btn btn-red pressable">
                Shop best sellers
              </Link>
              <Link href="/contact" className="btn pressable">
                Order support
              </Link>
            </div>
            <div className="text-xs text-[var(--muted)]">
              Ships fast. If you need help, we’ve got you.
            </div>
          </Reveal>
        </div>
      </div>
    </main>
  );
}
