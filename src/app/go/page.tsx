import Image from "next/image";
import type { Metadata } from "next";
import { AMAZON_LISTING_URL } from "@/lib/amazon";

const CART_PERMALINK =
  "https://usa-gummies.myshopify.com/cart/62295921099123:5";

export const metadata: Metadata = {
  title: "USA Gummies 5-Pack Bundle | Free Shipping | Made in USA",
  description:
    "Classic American gummy bears — no artificial dyes, all natural flavors. Get the 5-pack bundle with free shipping. Made in the USA.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "USA Gummies 5-Pack Bundle | Free Shipping",
    description:
      "Classic American gummy bears — no artificial dyes, all natural flavors. Get the 5-pack bundle with free shipping.",
    images: [{ url: "/Hero-pack.jpeg" }],
  },
};

export default function GoLandingPage() {
  return (
    <div className="min-h-screen" style={{ background: "var(--bg, #f8f5ef)" }}>
      {/* Top Banner */}
      <div
        className="text-center text-[13px] font-semibold tracking-wide text-white"
        style={{ background: "var(--navy)", padding: "10px 16px" }}
      >
        <span role="img" aria-label="US flag">🇺🇸</span> FREE SHIPPING on every 5-pack —{" "}
        <span style={{ color: "var(--gold)" }}>Save $1.93 per bag</span>
      </div>

      {/* Hero */}
      <section className="mx-auto grid max-w-[960px] items-center gap-8 px-5 py-12 md:grid-cols-2 md:gap-12 md:py-14">
        {/* Image */}
        <div className="relative flex justify-center md:order-1 order-2">
          <div className="relative w-full max-w-[320px] md:max-w-[380px]">
            <Image
              src="/Hero-pack.jpeg"
              alt="Bag of USA Gummies classic gummy bears"
              width={760}
              height={950}
              priority
              className="rounded-2xl object-contain drop-shadow-[0_24px_48px_rgba(13,28,51,0.12)]"
              style={{ animation: "lp-fadeUp 0.8s ease-out both" }}
            />
            <span
              className="absolute -top-3 right-2 rounded-md px-3 py-1.5 text-[13px] font-bold tracking-[1.5px] text-white"
              style={{
                background: "var(--navy)",
                fontFamily: "var(--font-display), Oswald, sans-serif",
                transform: "rotate(3deg)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                animation: "lp-fadeUp 0.8s 0.3s ease-out both",
              }}
            >
              <span role="img" aria-label="US flag">🇺🇸</span> MADE IN USA
            </span>
          </div>
        </div>

        {/* Content */}
        <div
          className="order-1 text-center md:order-2 md:text-left"
          style={{ animation: "lp-fadeUp 0.8s 0.15s ease-out both" }}
        >
          <h1
            className="text-[clamp(36px,5vw,54px)] leading-[1.05] font-black"
            style={{
              fontFamily: "var(--font-display), Oswald, sans-serif",
              color: "var(--navy)",
            }}
          >
            American Gummy Bears.
            <br />
            <span style={{ color: "var(--red)" }}>No Junk.</span>
          </h1>
          <p
            className="mx-auto mt-4 max-w-[420px] text-[17px] leading-relaxed md:mx-0"
            style={{ color: "var(--muted)" }}
          >
            Classic gummy bears made in the USA with natural fruit colors — zero
            artificial dyes. Grab the 5-pack and shipping&apos;s on us.
          </p>

          {/* Bundle Card */}
          <div
            className="relative mt-7 overflow-hidden rounded-2xl border-2 p-6 md:p-7"
            style={{
              background: "var(--surface, #fff)",
              borderColor: "var(--navy)",
            }}
          >
            {/* Top gradient bar */}
            <div
              className="absolute inset-x-0 top-0 h-1"
              style={{
                background:
                  "linear-gradient(90deg, var(--red), var(--navy), var(--red))",
              }}
            />

            <div className="flex items-baseline justify-between">
              <span
                className="text-[22px] tracking-[1px]"
                style={{
                  fontFamily: "var(--font-display), Oswald, sans-serif",
                  color: "var(--navy)",
                }}
              >
                5-BAG BUNDLE
              </span>
              <span className="rounded-full bg-[#2D7A3A] px-2.5 py-1 text-[12px] font-bold text-white">
                SAVE $1.93/BAG
              </span>
            </div>

            <div className="mt-1 flex items-baseline gap-3">
              <span
                className="text-[42px] leading-none"
                style={{
                  fontFamily: "var(--font-display), Oswald, sans-serif",
                  color: "var(--navy)",
                }}
              >
                $28.02
              </span>
              <span className="text-[15px] font-medium" style={{ color: "var(--muted)" }}>
                $5.60 / bag
              </span>
            </div>

            <div
              className="mt-1 text-[13px] line-through opacity-70"
              style={{ color: "var(--muted)" }}
            >
              $29.95 retail (5 × $5.99)
            </div>

            <div className="mt-5 flex flex-wrap gap-3 md:justify-start justify-center">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: "var(--navy)" }}>
                <span className="text-[#2D7A3A]">✓</span> Free shipping
              </span>
              <span className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: "var(--navy)" }}>
                <span className="text-[#2D7A3A]">✓</span> Made in USA
              </span>
              <span className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: "var(--navy)" }}>
                <span className="text-[#2D7A3A]">✓</span> No artificial dyes
              </span>
            </div>

            <a
              href={CART_PERMALINK}
              className="mt-5 block w-full rounded-xl py-[18px] text-center text-[22px] tracking-[1.5px] text-white no-underline transition-all hover:-translate-y-0.5"
              style={{
                background: "var(--red)",
                fontFamily: "var(--font-display), Oswald, sans-serif",
              }}
            >
              GET THE 5-PACK — FREE SHIPPING
            </a>

            <div
              className="mt-3 flex flex-wrap justify-center gap-5 text-[12px] font-medium"
              style={{ color: "var(--muted)" }}
            >
              <span>🔒 Secure checkout</span>
              <span>📦 Ships in 1–2 days</span>
              <span>⭐ 4.8-star rated</span>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section
        className="border-y py-9 px-5"
        style={{
          background: "var(--surface, #fff)",
          borderColor: "var(--border, #e8e4de)",
        }}
      >
        <div className="mx-auto max-w-[800px] text-center">
          <div className="text-2xl tracking-widest" style={{ color: "var(--gold)" }}>
            ★★★★★
          </div>
          <div
            className="mt-1.5 text-sm font-semibold"
            style={{ color: "var(--navy)" }}
          >
            4.8 stars from verified Amazon buyers
          </div>

          <div className="mt-6 grid gap-5 text-left sm:grid-cols-2">
            <div
              className="rounded-xl border p-5"
              style={{
                background: "var(--bg, #faf7f2)",
                borderColor: "var(--border, #e8e4de)",
              }}
            >
              <div className="text-sm" style={{ color: "var(--gold)" }}>
                ★★★★★
              </div>
              <p
                className="mt-2 text-sm leading-relaxed"
                style={{ color: "var(--navy)" }}
              >
                &ldquo;Absolutely delicious soft gummy bears made in America.
                You will not be disappointed!&rdquo;
              </p>
              <div
                className="mt-2 text-xs font-semibold"
                style={{ color: "var(--muted)" }}
              >
                — Michael D., verified buyer
              </div>
            </div>
            <div
              className="rounded-xl border p-5"
              style={{
                background: "var(--bg, #faf7f2)",
                borderColor: "var(--border, #e8e4de)",
              }}
            >
              <div className="text-sm" style={{ color: "var(--gold)" }}>
                ★★★★★
              </div>
              <p
                className="mt-2 text-sm leading-relaxed"
                style={{ color: "var(--navy)" }}
              >
                &ldquo;Gummies arrived fast. Nice stocking stuffers for my kids!
                Fresh and very good — will order more!&rdquo;
              </p>
              <div
                className="mt-2 text-xs font-semibold"
                style={{ color: "var(--muted)" }}
              >
                — Rene G., verified buyer
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Amazon Callout */}
      <section className="mx-auto max-w-[600px] px-5 py-12 text-center">
        <div
          className="rounded-xl border border-dashed p-7"
          style={{
            background: "var(--surface, #fff)",
            borderColor: "var(--border, #e8e4de)",
          }}
        >
          <h3
            className="text-[20px] tracking-[0.5px]"
            style={{
              fontFamily: "var(--font-display), Oswald, sans-serif",
              color: "var(--navy)",
            }}
          >
            PREFER TO PAY FULL PRICE FOR JUST ONE BAG?
          </h3>
          <p
            className="mx-auto mt-2 max-w-[440px] text-sm leading-relaxed"
            style={{ color: "var(--muted)" }}
          >
            Hey, we don&apos;t judge. One bag at $5.99 on Amazon — no bundle
            discount, no free shipping. But it&apos;s a free country.{" "}
            <span role="img" aria-label="US flag">🇺🇸</span>
          </p>
          <a
            href={AMAZON_LISTING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-[3px] transition-colors hover:text-[var(--red)]"
            style={{ color: "var(--navy)" }}
          >
            Buy 1 bag on Amazon →
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer
        className="text-center text-xs py-6 px-5"
        style={{
          background: "var(--navy)",
          color: "rgba(255,255,255,0.6)",
        }}
      >
        <p>
          © 2026 USA Gummies ·{" "}
          <a
            href="https://www.usagummies.com"
            className="transition-colors hover:text-white"
            style={{ color: "rgba(255,255,255,0.8)", textDecoration: "none" }}
          >
            usagummies.com
          </a>{" "}
          · Made with <span role="img" aria-label="US flag">🇺🇸</span> in America
        </p>
      </footer>

      {/* Animations */}
      <style>{`
        @keyframes lp-fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
