import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { AMAZON_LISTING_URL } from "@/lib/amazon";
import { AMAZON_REVIEWS } from "@/data/amazonReviews";
import { US_MAP_SVG } from "@/lib/marketing/us-map-svg";
import GoTracker from "./GoTracker.client";

// API route that creates a Storefront API cart and redirects to checkout
// (bypasses the Shop Pay / shop.app redirect that the raw cart permalink triggers)
//
// 2026-04-30: bundle ladder migrated to native Shopify BXGY automatic discounts.
// Buy 4 Get 1 Free → qty=5 ($23.96), Buy 5 Get 2 → qty=7 ($29.95),
// Buy 7 Get 3 → qty=10 ($41.93). Free shipping applies to ALL orders.
const CHECKOUT_URL = "/go/checkout?qty=5";  // 5-Pack: B4G1F
const CHECKOUT_URL_7 = "/go/checkout?qty=7";  // 7-Pack: B5G2F
const CHECKOUT_URL_10 = "/go/checkout?qty=10"; // 10-Pack: B7G3F
const CHECKOUT_URL_1 = "/go/checkout?qty=1";

const TOP_REVIEWS = AMAZON_REVIEWS.reviews.slice(0, 3);

export const metadata: Metadata = {
  title: "USA Gummies | Free Shipping on Every Order | Made in USA",
  description:
    "America's Candy — classic gummy bears, no artificial dyes, all natural flavors. Free shipping on every order, no minimum. Made in the USA.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "USA Gummies | Free Shipping on Every Order",
    description:
      "America's Candy — no artificial dyes, all natural flavors. Free shipping on every order. Made in the USA.",
    images: [{ url: "/Hero-pack.jpeg" }],
  },
};

export default function GoLandingPage() {
  return (
    <div className="lp-root">
      <GoTracker />
      <style>{`
        .lp-root {
          min-height: 100vh;
          background: #f8f5ef !important;
          color: #1B2A4A;
          font-family: var(--font-sans), 'Space Grotesk', system-ui, sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        .lp-root * { box-sizing: border-box; }
        .lp-root .bg-white { background-color: #ffffff !important; }
        .lp-display {
          font-family: var(--font-display), 'Oswald', sans-serif;
        }
        @keyframes lp-fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .lp-animate { animation: lp-fadeUp 0.8s ease-out both; }
        .lp-animate-d1 { animation: lp-fadeUp 0.8s 0.15s ease-out both; }
        .lp-animate-d2 { animation: lp-fadeUp 0.8s 0.3s ease-out both; }
        .lp-cta {
          display: block;
          width: 100%;
          padding: 18px;
          background: #c7362c;
          color: #ffffff;
          font-family: var(--font-display), 'Oswald', sans-serif;
          font-size: 22px;
          letter-spacing: 1.5px;
          text-align: center;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          text-decoration: none;
          transition: background 0.2s, transform 0.15s;
        }
        .lp-cta:hover {
          background: #a82920;
          transform: translateY(-1px);
        }
        .lp-amazon-cta {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          padding: 16px 24px;
          background: #ffffff;
          border: 2px solid #1B2A4A;
          border-radius: 12px;
          color: #1B2A4A;
          font-family: var(--font-display), 'Oswald', sans-serif;
          font-size: 18px;
          letter-spacing: 1px;
          text-decoration: none;
          cursor: pointer;
          transition: background 0.2s, border-color 0.2s, transform 0.15s;
        }
        .lp-amazon-cta:hover {
          background: #f0ede6;
          border-color: #c7362c;
          transform: translateY(-1px);
        }
        .lp-sticky-bar {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          z-index: 50;
          background: rgba(255,255,255,0.97);
          backdrop-filter: blur(12px);
          border-top: 1px solid rgba(15,27,45,0.1);
          padding: 12px 16px;
          display: flex;
          gap: 8px;
        }
        @media (min-width: 768px) {
          .lp-sticky-bar { display: none; }
        }
        /* Supply-chain US map — base styles + highlight the 5 active states.
           The SVG's internal defs/stylesheet block was stripped (hydration
           mismatch); we recreate the base styles here. Note: do NOT write
           the literal substring style-with-angle-brackets inside this CSS —
           React's server renderer escapes it to a CSS hex sequence
           (CSS escape for "s") which then mismatches client hydration and triggers React
           error #418. (Fix: 2026-04-30, see commit re hydration #418.)
           2026-04-30: mobile fix — bump min-height + force preserveAspectRatio
           via container so the SVG doesn't render as a tiny postage stamp on
           narrow viewports. */
        .supply-chain-map {
          width: 100%;
          max-width: 760px;
          margin: 24px auto 0;
          padding: 0;
        }
        .supply-chain-map svg {
          width: 100%;
          height: auto;
          min-height: 200px;
          display: block;
          aspect-ratio: 960 / 600;
        }
        .supply-chain-map svg .state path { fill: #e6e1d6; }
        .supply-chain-map svg .borders { stroke: #d6d0c3; stroke-width: 0.75; }
        .supply-chain-map svg .dccircle { display: none; }
        .supply-chain-map svg path.in,
        .supply-chain-map svg path.wi,
        .supply-chain-map svg path.wa,
        .supply-chain-map svg path.wy,
        .supply-chain-map svg path.pa { fill: #c7362c; }
        @media (max-width: 480px) {
          .supply-chain-map svg { min-height: 220px; }
        }
      `}</style>

      {/* Header */}
      <header
        className="lp-animate"
        style={{
          background: "rgba(255,255,255,0.96)",
          borderBottom: "1px solid rgba(15,27,45,0.12)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <Image
              src="/brand/logo.png"
              alt="USA Gummies logo"
              width={120}
              height={40}
              style={{ height: 36, width: "auto", objectFit: "contain" }}
              priority
            />
          </Link>
          <a
            href={CHECKOUT_URL}
            className="lp-display"
            style={{
              background: "#c7362c",
              color: "#fff",
              padding: "8px 20px",
              borderRadius: 8,
              fontSize: 14,
              letterSpacing: "1px",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            BUY 4, GET 1 FREE
          </a>
        </div>
      </header>

      {/* Top Banner */}
      <div
        style={{
          background: "#1B2A4A",
          color: "#ffffff",
          textAlign: "center",
          padding: "10px 16px",
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "0.5px",
        }}
      >
        🇺🇸 <strong>FREE SHIPPING</strong> on every order · <span style={{ color: "#c7a062" }}>Buy 4, Get 1 FREE — bundle deal up to 3 free bags</span>
      </div>

      {/* MOBILE-FIRST HERO: Image + Compact Offer */}
      <section style={{ maxWidth: 960, margin: "0 auto", padding: "24px 20px 0" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 0, alignItems: "center" }} className="md:!grid-cols-2 md:!gap-12">

          {/* Mobile: Compact hero with image + CTA side by side */}
          <div className="lp-animate" style={{ textAlign: "center" }}>
            {/* Headline pill — single distinct claim, no Made-in-USA repetition (the bag + supply-chain section already say it) */}
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 6, marginBottom: 14 }}>
              <span style={{ background: "#2D7A3A", color: "#fff", padding: "5px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, letterSpacing: "1px" }} className="lp-display">
                NO ARTIFICIAL DYES
              </span>
            </div>

            <h1
              className="lp-display"
              style={{
                fontSize: "clamp(28px, 4.5vw, 48px)",
                lineHeight: 1.05,
                color: "#1B2A4A",
                margin: 0,
              }}
            >
              No Red 40. <span style={{ color: "#c7362c" }}>No Yellow 5. No Blue 1.</span>
            </h1>
            <p style={{ fontSize: 14, lineHeight: 1.5, color: "#5f5b56", marginTop: 12, maxWidth: 460, marginLeft: "auto", marginRight: "auto" }}>
              American gummy bears, made across the country.
            </p>

            {/* Social proof stat */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12 }}>
              <span style={{ color: "#c7a062", fontSize: 16 }}>★★★★★</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#1B2A4A" }}>
                {AMAZON_REVIEWS.aggregate.rating.toFixed(1)} from {AMAZON_REVIEWS.aggregate.count} real reviews
              </span>
            </div>
          </div>

          {/* Image - smaller on mobile to keep CTA visible */}
          <div className="lp-animate" style={{ display: "flex", justifyContent: "center", position: "relative", marginTop: 16 }}>
            <div style={{ position: "relative", width: "100%", maxWidth: 240 }} className="md:!max-w-[340px]">
              <Image
                src="/Hero-pack.jpeg"
                alt="Bag of USA Gummies classic gummy bears"
                width={760}
                height={950}
                priority
                style={{
                  width: "100%",
                  height: "auto",
                  borderRadius: 16,
                  boxShadow: "0 24px 48px rgba(27,42,74,0.12)",
                }}
              />
            </div>
          </div>
        </div>

        {/* Trust bar */}
        <div className="lp-animate-d1" style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "12px 24px", marginTop: 20, padding: "14px 20px", background: "#ffffff", borderRadius: 12, border: "1px solid #e0dcd6" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#1B2A4A", display: "flex", alignItems: "center", gap: 5 }}>
            🇺🇸 Made in the USA
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#1B2A4A", display: "flex", alignItems: "center", gap: 5 }}>
            🌿 No artificial dyes
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#1B2A4A", display: "flex", alignItems: "center", gap: 5 }}>
            ⭐ {AMAZON_REVIEWS.aggregate.rating.toFixed(1)} from {AMAZON_REVIEWS.aggregate.count} real reviews
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#1B2A4A", display: "flex", alignItems: "center", gap: 5 }}>
            🚚 Ships in 24 hours
          </span>
        </div>

        {/* Inline CTA section — visible above fold on mobile */}
        <div className="lp-animate-d1" style={{ marginTop: 20, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
          <div style={{ textAlign: "center", marginBottom: 14 }}>
            <span className="lp-display" style={{ fontSize: 16, letterSpacing: "2px", color: "#5f5b56" }}>
              CHOOSE YOUR OPTION
            </span>
          </div>
          {/* Price + value prop */}
          <div style={{
            background: "#ffffff",
            border: "2px solid #c7362c",
            borderRadius: 16,
            padding: "20px 20px 24px",
            position: "relative",
            overflow: "hidden",
          }}>
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 4,
                background: "linear-gradient(90deg, #c7362c, #1B2A4A, #c7362c)",
              }}
            />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="lp-display" style={{ fontSize: 20, letterSpacing: "1px", color: "#1B2A4A" }}>
                BUY 4, GET 1 FREE
              </span>
              <span style={{ background: "#c7362c", color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20 }}>
                MOST POPULAR
              </span>
            </div>
            <div style={{ fontSize: 12, color: "#5f5b56", marginTop: 4, fontStyle: "italic" }}>
              5-Pack — half of our customers start here.
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
              <span className="lp-display" style={{ fontSize: 38, color: "#1B2A4A", lineHeight: 1 }}>$23.96</span>
              <span style={{ textDecoration: "line-through", fontSize: 16, color: "#999", fontWeight: 500 }}>$29.95</span>
            </div>
            <div style={{ fontSize: 13, color: "#2D7A3A", fontWeight: 700, marginTop: 2 }}>
              5 bags, pay for 4 — that&rsquo;s 1 bag FREE.
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#1B2A4A", display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: "#2D7A3A", fontSize: 15 }}>✓</span> FREE SHIPPING
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#1B2A4A", display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: "#2D7A3A", fontSize: 15 }}>✓</span> $4.79 / bag
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#1B2A4A", display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: "#2D7A3A", fontSize: 15 }}>✓</span> Ships in 1–2 days
              </span>
            </div>

            <a href={CHECKOUT_URL} className="lp-cta" style={{ marginTop: 16 }}>
              BUY 4, GET 1 FREE — $23.96 + FREE SHIP
            </a>

            {/* Upsell tier — 7-Pack: Buy 5 Get 2 Free */}
            <a href={CHECKOUT_URL_7} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              marginTop: 10, padding: "12px 14px",
              background: "#fffaf2", border: "2px solid #c7a062", borderRadius: 10,
              textDecoration: "none", color: "#1B2A4A",
            }}>
              <span>
                <span className="lp-display" style={{ fontSize: 15, letterSpacing: "0.5px" }}>BUY 5, GET 2 FREE</span>
                <span style={{ display: "block", fontSize: 11, color: "#5f5b56" }}>7-Pack · $4.28/bag · FREE SHIP</span>
              </span>
              <span className="lp-display" style={{ fontSize: 20, color: "#c7362c" }}>$29.95 →</span>
            </a>

            {/* Upsell tier — 10-Pack: Buy 7 Get 3 Free */}
            <a href={CHECKOUT_URL_10} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              marginTop: 8, padding: "12px 14px",
              background: "#fff5f3", border: "2px solid #c7362c", borderRadius: 10,
              textDecoration: "none", color: "#1B2A4A",
            }}>
              <span>
                <span className="lp-display" style={{ fontSize: 15, letterSpacing: "0.5px" }}>BUY 7, GET 3 FREE</span>
                <span style={{ display: "block", fontSize: 11, color: "#5f5b56" }}>10-Pack · $4.19/bag · FREE SHIP · BEST VALUE</span>
              </span>
              <span className="lp-display" style={{ fontSize: 20, color: "#c7362c" }}>$41.93 →</span>
            </a>

            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 12, fontSize: 11, color: "#5f5b56", fontWeight: 500 }}>
              <span>🔒</span>
              <span>America&rsquo;s Candy &middot; 100% American supply chain &middot; 30-day satisfaction guarantee</span>
            </div>
          </div>

          {/* Single bag — low commitment entry point. Free ship 2026-04-28. */}
          <div style={{
            marginTop: 12,
            background: "#ffffff",
            border: "2px solid #e0dcd6",
            borderRadius: 16,
            padding: "16px 20px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="lp-display" style={{ fontSize: 18, letterSpacing: "1px", color: "#1B2A4A" }}>
                TRY 1 BAG
              </span>
              <span className="lp-display" style={{ fontSize: 24, color: "#1B2A4A" }}>$5.99</span>
            </div>
            <div style={{ fontSize: 12, color: "#2D7A3A", fontWeight: 700, marginTop: 4 }}>
              ✓ FREE SHIPPING · Ships direct in 1–2 days
            </div>
            <div style={{ fontSize: 11, color: "#5f5b56", marginTop: 6, lineHeight: 1.4 }}>
              💡 Buy 4 more and get the <strong style={{ color: "#1B2A4A" }}>5th bag FREE</strong> — $23.96 total + free ship.
            </div>
            <a
              href={CHECKOUT_URL_1}
              className="lp-display"
              style={{
                display: "block",
                width: "100%",
                marginTop: 12,
                padding: "14px",
                background: "#1B2A4A",
                color: "#ffffff",
                fontSize: 17,
                letterSpacing: "1px",
                textAlign: "center",
                border: "none",
                borderRadius: 10,
                cursor: "pointer",
                textDecoration: "none",
                transition: "background 0.2s",
              }}
            >
              TRY 1 BAG — $5.99 FREE SHIP
            </a>
          </div>

          {/* Amazon — third option */}
          <div style={{ marginTop: 12, textAlign: "center" }}>
            <a
              href={AMAZON_LISTING_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#5f5b56", fontSize: 13, textDecoration: "underline", textUnderlineOffset: 3 }}
            >
              Or buy on Amazon →
            </a>
          </div>

          {/* Money-back guarantee */}
          <div style={{
            marginTop: 20,
            padding: "14px 16px",
            background: "rgba(45,122,58,0.06)",
            border: "1px solid rgba(45,122,58,0.2)",
            borderRadius: 12,
            textAlign: "center",
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#2D7A3A" }}>
              🇺🇸 100% Satisfaction Guarantee
            </div>
            <div style={{ fontSize: 12, color: "#5f5b56", marginTop: 4, lineHeight: 1.5 }}>
              Love them or your money back — no questions asked. Made in FDA-registered facilities right here in the USA.
            </div>
          </div>
        </div>
      </section>

      {/* Anti-villain band — Red 3 ban + dye-free framing */}
      <section style={{ background: "#1B2A4A", color: "#ffffff", padding: "36px 20px", marginTop: 32 }}>
        <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center" }}>
          <div className="lp-display" style={{ fontSize: 22, letterSpacing: "1px", color: "#c7a062", marginBottom: 14 }}>
            FDA BANNED RED 3 IN JANUARY 2025.
          </div>
          <div style={{ fontSize: 16, lineHeight: 1.55, color: "#ffffff", maxWidth: 580, margin: "0 auto" }}>
            We never used it. We never used Red 40, Yellow 5, or Blue 1 either. The candy your grandparents ate
            wasn&rsquo;t made with petroleum dyes. Ours isn&rsquo;t either.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 520, margin: "20px auto 0" }}>
            <div style={{ background: "rgba(255,255,255,0.08)", padding: "14px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#c7a062", letterSpacing: "1px", marginBottom: 6 }}>COMMON GUMMY BEARS</div>
              <div style={{ fontSize: 12, lineHeight: 1.6, color: "rgba(255,255,255,0.85)", textAlign: "left" }}>
                ✗ Red 40<br />
                ✗ Yellow 5<br />
                ✗ Blue 1<br />
                ✗ High-fructose corn syrup
              </div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.08)", padding: "14px 12px", borderRadius: 10, border: "1px solid #2D7A3A" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#7BD898", letterSpacing: "1px", marginBottom: 6 }}>USA GUMMIES</div>
              <div style={{ fontSize: 12, lineHeight: 1.6, color: "rgba(255,255,255,0.95)", textAlign: "left" }}>
                ✓ Real fruit color<br />
                ✓ 5 natural flavors<br />
                ✓ Made across 5 US states<br />
                ✓ Veteran-owned repack
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Supply chain story — 6 locations, 2 rows (production + ops). Typography-only, no emojis. */}
      <section style={{ background: "#f8f5ef", padding: "44px 20px", borderBottom: "1px solid #e0dcd6" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", textAlign: "center" }}>
          <div className="lp-display" style={{ fontSize: 26, letterSpacing: "1px", color: "#1B2A4A" }}>
            ACROSS AMERICA. ONE BAG.
          </div>
          <div style={{ fontSize: 14, color: "#5f5b56", marginTop: 8, marginBottom: 8 }}>
            Six locations. Five states. From sea to shining sea.
          </div>

          {/* US map — highlights IN, WI, WA, WY, PA in red. Inlined SVG so we can override .state fill via CSS. */}
          <div className="supply-chain-map" dangerouslySetInnerHTML={{ __html: US_MAP_SVG }} aria-hidden="true" />

          {/* Inline state-chip legend — collapses to a 2-col stack on mobile,
              5-col flow on desktop. Replaces the prior 6-card / 2-row grid that
              read as text-heavy on narrow viewports. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "10px 16px",
              maxWidth: 720,
              margin: "20px auto 0",
              padding: "0 4px",
            }}
            className="sm:!grid-cols-5"
          >
            {[
              { state: "IN", role: "Gummies crafted" },
              { state: "WI", role: "Packaging" },
              { state: "WA", role: "West Coast warehouse" },
              { state: "PA", role: "East Coast warehouse" },
              { state: "WY", role: "Corporate" },
            ].map((chip) => (
              <div
                key={chip.state}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  textAlign: "left",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    flex: "0 0 auto",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 30,
                    height: 30,
                    background: "#c7362c",
                    color: "#fff",
                    fontFamily: "var(--font-display), 'Oswald', sans-serif",
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: "0.5px",
                    border: "2px solid #1B2A4A",
                    borderRadius: 6,
                  }}
                >
                  {chip.state}
                </span>
                <span style={{ fontSize: 12, color: "#1B2A4A", lineHeight: 1.3 }}>
                  {chip.role}
                </span>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 12, color: "#5f5b56", marginTop: 24, fontStyle: "italic" }}>
            Most &ldquo;Made in USA&rdquo; brands won&rsquo;t tell you which states. We will.
          </div>
        </div>
      </section>

      {/* Social Proof — Reviews */}
      <section style={{ background: "#ffffff", borderTop: "1px solid #e0dcd6", borderBottom: "1px solid #e0dcd6", padding: "36px 20px" }}>
        <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center" }}>
          <div className="lp-display" style={{ fontSize: 22, letterSpacing: "1px", color: "#1B2A4A" }}>
            CUSTOMERS LOVE US
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
            <span style={{ color: "#c7a062", fontSize: 24, letterSpacing: 2 }}>★★★★★</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#1B2A4A" }}>
              {AMAZON_REVIEWS.aggregate.rating.toFixed(1)} stars from {AMAZON_REVIEWS.aggregate.count} real reviews
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16, marginTop: 24, textAlign: "left" }} className="sm:!grid-cols-3">
            {TOP_REVIEWS.map((r) => (
              <div key={r.id} style={{ background: "#f8f5ef", padding: 20, borderRadius: 12, border: "1px solid #e0dcd6" }}>
                <div style={{ color: "#c7a062", fontSize: 14 }}>{"★".repeat(r.rating)}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1B2A4A", marginTop: 6 }}>
                  &ldquo;{r.title}&rdquo;
                </div>
                <p style={{ fontSize: 13, lineHeight: 1.55, color: "#1B2A4A", marginTop: 6, marginBottom: 8 }}>
                  {r.body.length > 120 ? r.body.slice(0, 120) + "…" : r.body}
                </p>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11 }}>
                  <span style={{ color: "#5f5b56", fontWeight: 600 }}>— {r.authorName}</span>
                  <span style={{ color: r.program === "vine" ? "#5f5b56" : "#2D7A3A", fontWeight: 600 }}>
                    {r.program === "vine" ? "Amazon Vine" : "✓ Verified buyer"}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <a
            href="/shop"
            style={{ display: "inline-block", marginTop: 16, fontSize: 13, fontWeight: 600, color: "#1B2A4A", textDecoration: "underline", textUnderlineOffset: 3 }}
          >
            See all options →
          </a>
        </div>
      </section>

      {/* Second CTA block — after social proof. (Killed redundant "Why Choose USA Gummies?" 4-card section 2026-04-29 — same claims appeared 4x earlier on page.) */}
      <section style={{ maxWidth: 560, margin: "0 auto", padding: "32px 20px" }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <span className="lp-display" style={{ fontSize: 22, letterSpacing: "1px", color: "#1B2A4A" }}>
            READY TO TRY THEM?
          </span>
          <p style={{ color: "#5f5b56", fontSize: 14, lineHeight: 1.6, maxWidth: 440, margin: "8px auto 0" }}>
            Free shipping on every order. Try 1 bag or stack up for the best per-bag price — ships in 1–2 days.
          </p>
        </div>
        <a href={CHECKOUT_URL} className="lp-cta">
          BUY 4, GET 1 FREE — $23.96 + FREE SHIP
        </a>
        <a
          href={CHECKOUT_URL_1}
          className="lp-display"
          style={{
            display: "block",
            width: "100%",
            marginTop: 10,
            padding: "14px",
            background: "#1B2A4A",
            color: "#ffffff",
            fontSize: 17,
            letterSpacing: "1px",
            textAlign: "center",
            border: "none",
            borderRadius: 10,
            cursor: "pointer",
            textDecoration: "none",
          }}
        >
          TRY 1 BAG — $5.99 + FREE SHIP
        </a>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 10, fontSize: 11, color: "#5f5b56", fontWeight: 500 }}>
          <span>🔒</span>
          <span>America&rsquo;s Candy &middot; Love them or your money back</span>
        </div>
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <a
            href={AMAZON_LISTING_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#5f5b56", fontSize: 13, textDecoration: "underline", textUnderlineOffset: 3 }}
          >
            Or buy on Amazon →
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ background: "#1B2A4A", color: "rgba(255,255,255,0.6)", textAlign: "center", padding: "24px 20px", fontSize: 12, paddingBottom: 80 }}>
        <p style={{ margin: 0 }}>
          © 2026 USA Gummies ·{" "}
          <a href="https://www.usagummies.com" style={{ color: "rgba(255,255,255,0.8)", textDecoration: "none" }}>usagummies.com</a>
          {" "}· Made with 🇺🇸 in America
        </p>
      </footer>

      {/* Mobile sticky bottom bar — both Shopify options */}
      <div className="lp-sticky-bar">
        <a
          href={CHECKOUT_URL}
          className="lp-display"
          style={{
            flex: 2,
            background: "#c7362c",
            color: "#fff",
            padding: "12px 16px",
            borderRadius: 10,
            fontSize: 15,
            letterSpacing: "0.5px",
            textDecoration: "none",
            fontWeight: 700,
            textAlign: "center",
            lineHeight: 1.2,
          }}
        >
          BUY 4 GET 1 FREE<br /><span style={{ fontSize: 11, fontWeight: 500, letterSpacing: 0 }}>$23.96 + free ship</span>
        </a>
        <a
          href={CHECKOUT_URL_1}
          className="lp-display"
          style={{
            flex: 1,
            background: "#1B2A4A",
            color: "#fff",
            padding: "12px 8px",
            borderRadius: 10,
            fontSize: 13,
            letterSpacing: "0.5px",
            textDecoration: "none",
            fontWeight: 700,
            textAlign: "center",
            lineHeight: 1.2,
          }}
        >
          1 BAG<br /><span style={{ fontSize: 10, fontWeight: 500, letterSpacing: 0 }}>$5.99</span>
        </a>
      </div>
    </div>
  );
}
