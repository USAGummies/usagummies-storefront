import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { AMAZON_LISTING_URL } from "@/lib/amazon";

// API route that creates a Storefront API cart and redirects to checkout
// (bypasses the Shop Pay / shop.app redirect that the raw cart permalink triggers)
const CHECKOUT_URL = "/go/checkout";
const CHECKOUT_URL_1 = "/go/checkout?qty=1";

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
    <div className="lp-root">
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
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.18em", textTransform: "uppercase", color: "#1B2A4A" }}>
              Made in the USA
            </span>
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
            GET THE 5-PACK
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
        🇺🇸 FREE SHIPPING on every 5-pack — <span style={{ color: "#c7a062" }}>Save $0.99 per bag vs. retail</span>
      </div>

      {/* MOBILE-FIRST HERO: Image + Compact Offer */}
      <section style={{ maxWidth: 960, margin: "0 auto", padding: "24px 20px 0" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 0, alignItems: "center" }} className="md:!grid-cols-2 md:!gap-12">

          {/* Mobile: Compact hero with image + CTA side by side */}
          <div className="lp-animate" style={{ textAlign: "center" }}>
            {/* Headline pills */}
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 6, marginBottom: 12 }}>
              <span style={{ background: "#1B2A4A", color: "#fff", padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, letterSpacing: "1px" }} className="lp-display">
                🇺🇸 MADE IN AMERICA
              </span>
              <span style={{ background: "#2D7A3A", color: "#fff", padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, letterSpacing: "1px" }} className="lp-display">
                NO ARTIFICIAL DYES
              </span>
              <span style={{ background: "#c7a062", color: "#1B2A4A", padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, letterSpacing: "1px" }} className="lp-display">
                ALL NATURAL
              </span>
            </div>

            <h1
              className="lp-display"
              style={{
                fontSize: "clamp(32px, 5vw, 54px)",
                lineHeight: 1.05,
                color: "#1B2A4A",
                margin: 0,
              }}
            >
              American Gummy Bears.
              <br />
              <span style={{ color: "#c7362c" }}>No Junk.</span>
            </h1>
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
              <span
                className="lp-display lp-animate-d2"
                style={{
                  position: "absolute",
                  top: -10,
                  right: -4,
                  background: "#1B2A4A",
                  color: "#fff",
                  fontSize: 12,
                  letterSpacing: "1.5px",
                  padding: "5px 12px",
                  borderRadius: 6,
                  transform: "rotate(3deg)",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                }}
              >
                🇺🇸 MADE IN USA
              </span>
            </div>
          </div>
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
                5-BAG BUNDLE
              </span>
              <span style={{ background: "#c7362c", color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20 }}>
                BEST DEAL
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
              <span className="lp-display" style={{ fontSize: 38, color: "#1B2A4A", lineHeight: 1 }}>$25.00</span>
              <span style={{ textDecoration: "line-through", fontSize: 16, color: "#999", fontWeight: 500 }}>$29.95</span>
            </div>
            <div style={{ fontSize: 13, color: "#2D7A3A", fontWeight: 700, marginTop: 2 }}>
              You save $4.95 — that&apos;s a free bag!
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#1B2A4A", display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: "#2D7A3A", fontSize: 15 }}>✓</span> Free shipping included
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#1B2A4A", display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: "#2D7A3A", fontSize: 15 }}>✓</span> Ships direct to you
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#1B2A4A", display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: "#2D7A3A", fontSize: 15 }}>✓</span> $25 total — no surprises
              </span>
            </div>

            <a href={CHECKOUT_URL} className="lp-cta" style={{ marginTop: 16 }}>
              GET THE 5-PACK — $25 TOTAL
            </a>

            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 10, fontSize: 11, color: "#5f5b56", fontWeight: 500 }}>
              <span>🔒</span>
              <span>Family-owned American business · Shipped from Utah</span>
            </div>
          </div>

          {/* Single bag Shopify — low commitment entry point */}
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
            <div style={{ fontSize: 12, color: "#5f5b56", marginTop: 4 }}>
              + shipping · Ships direct from our facility
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
              TRY 1 BAG — $5.99
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

      {/* Social Proof */}
      <section style={{ background: "#ffffff", borderTop: "1px solid #e0dcd6", borderBottom: "1px solid #e0dcd6", padding: "36px 20px", marginTop: 32 }}>
        <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center" }}>
          <div style={{ color: "#c7a062", fontSize: 24, letterSpacing: 2 }}>★★★★★</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1B2A4A", marginTop: 6 }}>4.8 stars from verified Amazon buyers</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20, marginTop: 24, textAlign: "left" }} className="sm:!grid-cols-2">
            <div style={{ background: "#f8f5ef", padding: 20, borderRadius: 12, border: "1px solid #e0dcd6" }}>
              <div style={{ color: "#c7a062", fontSize: 14 }}>★★★★★</div>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: "#1B2A4A", marginTop: 8, marginBottom: 8 }}>
                &ldquo;Absolutely delicious soft gummy bears made in America. You will not be disappointed!&rdquo;
              </p>
              <div style={{ fontSize: 12, color: "#5f5b56", fontWeight: 600 }}>— Michael D., verified buyer</div>
            </div>
            <div style={{ background: "#f8f5ef", padding: 20, borderRadius: 12, border: "1px solid #e0dcd6" }}>
              <div style={{ color: "#c7a062", fontSize: 14 }}>★★★★★</div>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: "#1B2A4A", marginTop: 8, marginBottom: 8 }}>
                &ldquo;Gummies arrived fast. Nice stocking stuffers for my kids! Fresh and very good — will order more!&rdquo;
              </p>
              <div style={{ fontSize: 12, color: "#5f5b56", fontWeight: 600 }}>— Rene G., verified buyer</div>
            </div>
          </div>
        </div>
      </section>

      {/* Second CTA block — after social proof */}
      <section style={{ maxWidth: 560, margin: "0 auto", padding: "32px 20px" }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <span className="lp-display" style={{ fontSize: 22, letterSpacing: "1px", color: "#1B2A4A" }}>
            READY TO TRY THEM?
          </span>
          <p style={{ color: "#5f5b56", fontSize: 14, lineHeight: 1.6, maxWidth: 440, margin: "8px auto 0" }}>
            Free shipping on the 5-pack. Or grab a single bag to try us out — ships in 1–2 days.
          </p>
        </div>
        <a href={CHECKOUT_URL} className="lp-cta">
          GET THE 5-PACK — $25 TOTAL
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
          TRY 1 BAG — $5.99
        </a>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 10, fontSize: 11, color: "#5f5b56", fontWeight: 500 }}>
          <span>🔒</span>
          <span>Family-owned American business · Love them or your money back</span>
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
          5-PACK $25<br /><span style={{ fontSize: 11, fontWeight: 500, letterSpacing: 0 }}>free shipping</span>
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
