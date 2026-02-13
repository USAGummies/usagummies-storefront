import Image from "next/image";
import Link from "next/link";
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
        .lp-amazon-btn {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 12px 28px;
          background: #ffffff;
          border: 2px solid #1B2A4A;
          border-radius: 12px;
          color: #1B2A4A;
          font-size: 15px;
          font-weight: 700;
          text-decoration: none;
          transition: background 0.2s, border-color 0.2s, transform 0.15s;
        }
        .lp-amazon-btn:hover {
          background: #f0ede6;
          border-color: #c7362c;
          transform: translateY(-1px);
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
            href={CART_PERMALINK}
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
        🇺🇸 FREE SHIPPING on every 5-pack — <span style={{ color: "#c7a062" }}>Save $0.39 per bag vs. retail</span>
      </div>

      {/* Hero */}
      <section style={{ maxWidth: 960, margin: "0 auto", padding: "48px 20px 40px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 32, alignItems: "center" }} className="md:!grid-cols-2 md:!gap-12">
          {/* Content - shows first on mobile */}
          <div className="lp-animate-d1" style={{ textAlign: "center" }}>
            {/* Headline pills */}
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, marginBottom: 16 }}>
              <span style={{ background: "#1B2A4A", color: "#fff", padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, letterSpacing: "1px" }} className="lp-display">
                🇺🇸 MADE IN AMERICA
              </span>
              <span style={{ background: "#2D7A3A", color: "#fff", padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, letterSpacing: "1px" }} className="lp-display">
                NO ARTIFICIAL DYES
              </span>
              <span style={{ background: "#c7a062", color: "#1B2A4A", padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, letterSpacing: "1px" }} className="lp-display">
                ALL NATURAL
              </span>
            </div>

            <h1
              className="lp-display"
              style={{
                fontSize: "clamp(36px, 5vw, 54px)",
                lineHeight: 1.05,
                color: "#1B2A4A",
                margin: 0,
              }}
            >
              American Gummy Bears.
              <br />
              <span style={{ color: "#c7362c" }}>No Junk.</span>
            </h1>
            <p style={{ color: "#5f5b56", fontSize: 17, lineHeight: 1.6, marginTop: 16, maxWidth: 460, marginLeft: "auto", marginRight: "auto" }}>
              Classic gummy bears made in the USA with natural fruit colors — zero artificial dyes. Grab the 5-pack and shipping&apos;s on us.
            </p>

            {/* Savings callout */}
            <div style={{ marginTop: 20, display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ background: "#ffffff", border: "2px solid #2D7A3A", borderRadius: 12, padding: "10px 20px", textAlign: "center" }}>
                <div className="lp-display" style={{ fontSize: 28, color: "#2D7A3A", lineHeight: 1 }}>$5.60</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#5f5b56", marginTop: 2 }}>per bag in 5-pack</div>
              </div>
              <div style={{ background: "#ffffff", border: "1px solid rgba(15,27,45,0.12)", borderRadius: 12, padding: "10px 20px", textAlign: "center", opacity: 0.7 }}>
                <div className="lp-display" style={{ fontSize: 28, color: "#5f5b56", lineHeight: 1, textDecoration: "line-through" }}>$5.99</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#5f5b56", marginTop: 2 }}>single bag retail</div>
              </div>
            </div>
          </div>

          {/* Image */}
          <div className="lp-animate" style={{ display: "flex", justifyContent: "center", position: "relative" }}>
            <div style={{ position: "relative", width: "100%", maxWidth: 340 }}>
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
                  top: -12,
                  right: 10,
                  background: "#1B2A4A",
                  color: "#fff",
                  fontSize: 14,
                  letterSpacing: "1.5px",
                  padding: "6px 14px",
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

        {/* Bundle Card */}
        <div
          className="lp-animate-d1"
          style={{
            background: "#ffffff",
            border: "2px solid #1B2A4A",
            borderRadius: 16,
            padding: 28,
            marginTop: 40,
            maxWidth: 560,
            marginLeft: "auto",
            marginRight: "auto",
            position: "relative",
            overflow: "hidden",
          }}
        >
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
            <span className="lp-display" style={{ fontSize: 22, letterSpacing: "1px", color: "#1B2A4A" }}>
              5-BAG BUNDLE
            </span>
            <span style={{ background: "#2D7A3A", color: "#fff", fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 20 }}>
              BEST VALUE
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 6 }}>
            <span className="lp-display" style={{ fontSize: 42, color: "#1B2A4A", lineHeight: 1 }}>$28.02</span>
            <span style={{ fontSize: 15, color: "#5f5b56", fontWeight: 500 }}>$5.60 / bag</span>
          </div>

          <div style={{ fontSize: 13, color: "#5f5b56", textDecoration: "line-through", opacity: 0.7, marginTop: 4 }}>
            $29.95 retail (5 × $5.99)
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 20, flexWrap: "wrap", justifyContent: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#1B2A4A", display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ color: "#2D7A3A", fontSize: 16 }}>✓</span> Free shipping
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#1B2A4A", display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ color: "#2D7A3A", fontSize: 16 }}>✓</span> Made in USA
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#1B2A4A", display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ color: "#2D7A3A", fontSize: 16 }}>✓</span> No artificial dyes
            </span>
          </div>

          <a href={CART_PERMALINK} className="lp-cta" style={{ marginTop: 20 }}>
            GET THE 5-PACK — FREE SHIPPING
          </a>

          <div style={{ display: "flex", justifyContent: "center", gap: 20, marginTop: 14, fontSize: 12, color: "#5f5b56", fontWeight: 500, flexWrap: "wrap" }}>
            <span>🔒 Secure checkout</span>
            <span>📦 Ships in 1–2 days</span>
            <span>⭐ 4.8-star rated</span>
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section style={{ background: "#ffffff", borderTop: "1px solid #e0dcd6", borderBottom: "1px solid #e0dcd6", padding: "36px 20px" }}>
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

      {/* Amazon Callout */}
      <section style={{ maxWidth: 600, margin: "0 auto", padding: "48px 20px", textAlign: "center" }}>
        <div style={{ background: "#ffffff", border: "2px dashed #e0dcd6", borderRadius: 16, padding: "32px 24px" }}>
          <h3 className="lp-display" style={{ fontSize: 20, letterSpacing: "0.5px", color: "#1B2A4A", margin: 0 }}>
            PREFER TO PAY FULL PRICE FOR JUST ONE BAG?
          </h3>
          <p style={{ fontSize: 14, color: "#5f5b56", lineHeight: 1.6, marginTop: 8, marginBottom: 20, maxWidth: 440, marginLeft: "auto", marginRight: "auto" }}>
            Hey, we don&apos;t judge. One bag at $5.99 on Amazon — no bundle discount, no free shipping. But it&apos;s a free country. 🇺🇸
          </p>
          <a
            href={AMAZON_LISTING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="lp-amazon-btn"
          >
            <svg viewBox="0 0 603 182" style={{ height: 20, width: "auto" }} aria-label="Amazon">
              <path fill="#1B2A4A" d="M374.6 142.1c-34.1 25.2-83.6 38.6-126.2 38.6-59.7 0-113.5-22.1-154.2-58.8-3.2-2.9-.3-6.9 3.5-4.6 43.9 25.5 98.2 40.9 154.3 40.9 37.8 0 79.4-7.8 117.7-24.1 5.8-2.5 10.6 3.8 4.9 7.9z"/>
              <path fill="#1B2A4A" d="M388.8 126c-4.3-5.6-28.8-2.6-39.8-1.3-3.3.4-3.8-2.5-.8-4.6 19.5-13.7 51.5-9.7 55.2-5.1 3.7 4.6-1 36.8-19.2 52.1-2.8 2.4-5.5 1.1-4.2-2 4.1-10.3 13.2-33.4 8.9-39.1z"/>
              <path fill="#1B2A4A" d="M350 18.4V5.7c0-1.9 1.5-3.2 3.2-3.2h57c1.8 0 3.3 1.3 3.3 3.2v10.9c0 1.8-1.6 4.2-4.3 7.9l-29.5 42.2c11-.3 22.5 1.4 32.4 6.9 2.2 1.2 2.8 3.1 3 4.9v13.5c0 1.9-2.1 4.1-4.2 2.9-17.7-9.3-41.2-10.3-60.8.1-2 1.1-4.1-.9-4.1-2.9V79.2c0-2.1 0-5.7 2.1-8.9l34.2-49.1h-29.8c-1.8 0-3.3-1.3-3.3-3.2zM124.3 93.5h-17.3c-1.7-.1-3-1.4-3.1-3V5.8c0-1.8 1.5-3.3 3.4-3.3h16.2c1.7.1 3.1 1.4 3.2 3.1v11.1h.3c4.3-10.9 12.5-16 23.5-16 11.2 0 18.2 5.1 23.2 16 4.3-10.9 14.1-16 24.6-16 7.5 0 15.6 3.1 20.6 10 5.7 7.7 4.5 18.8 4.5 28.6l0 51.1c0 1.8-1.5 3.3-3.4 3.3h-17.3c-1.8-.1-3.2-1.6-3.2-3.3V45c0-3.8.3-13.4-.5-17-.1-5.7-4.5-7.3-8.9-7.3-3.7 0-7.5 2.4-9 6.3-1.6 3.9-1.4 10.4-1.4 18v45.5c0 1.8-1.5 3.3-3.4 3.3h-17.3c-1.8-.1-3.2-1.6-3.2-3.3V45c0-10.1 1.7-24.9-9.4-24.9-11.3 0-10.9 14.4-10.9 24.9v45.5c0 1.8-1.5 3.3-3.4 3.3zM461.6-1.4c25.7 0 39.6 22.1 39.6 50.2 0 27.2-15.4 48.7-39.6 48.7-25.2 0-38.9-22.1-38.9-49.6 0-27.6 13.8-49.3 38.9-49.3zm.1 18.2c-12.7 0-13.5 17.4-13.5 28.2 0 10.9-.2 34.1 13.4 34.1 13.4 0 14-18.7 14-30.1 0-7.5-.3-16.5-2.7-23.6-2-6.1-6-8.6-11.3-8.6zM536.8 93.5h-17.3c-1.8-.1-3.2-1.6-3.2-3.3l0-84.6c.1-1.7 1.6-3.1 3.4-3.1h16.1c1.6.1 2.8 1.2 3.2 2.7v12.9h.3c5-11.8 12-17.4 24.4-17.4 8 0 15.9 2.9 20.9 10.8 4.7 7.3 4.7 19.7 4.7 28.6v51.3c-.2 1.6-1.7 2.9-3.4 2.9h-17.4c-1.6-.1-3-1.4-3.1-2.9V44.3c0-10 1.2-24.6-9.5-24.6-3.7 0-7.1 2.5-8.8 6.3-2.1 4.8-2.4 9.5-2.4 18.4v45.9c0 1.8-1.6 3.3-3.4 3.3zM301.2 52c0 6.9.2 12.6-3.3 18.7-2.8 5-7.3 8-12.3 8-6.8 0-10.8-5.2-10.8-12.9 0-15.1 13.6-17.9 26.4-17.9v4.1zm17.9 43.3c-1.2 1-2.9 1.1-4.2.4-5.9-4.9-7-7.2-10.2-11.9-9.8 10-16.7 12.9-29.4 12.9-15 0-26.7-9.3-26.7-27.8 0-14.5 7.9-24.3 19.1-29.2 9.7-4.3 23.2-5.1 33.5-6.3v-2.3c0-4.3.3-9.4-2.2-13.1-2.2-3.3-6.3-4.7-10-4.7-6.8 0-12.9 3.5-14.4 10.7-.3 1.6-1.5 3.2-3.2 3.3l-16.8-1.8c-1.5-.3-3.2-1.5-2.8-3.8 4.1-21.8 23.8-28.4 41.5-28.4 9 0 20.8 2.4 27.9 9.2 9 8.4 8.1 19.7 8.1 31.9v28.9c0 8.7 3.6 12.5 7 17.2 1.2 1.7 1.4 3.7 0 4.9-3.7 3.1-10.3 8.8-13.9 12z"/>
              <path fill="#1B2A4A" d="M54.7 52c0 6.9.2 12.6-3.3 18.7-2.8 5-7.3 8-12.3 8-6.8 0-10.8-5.2-10.8-12.9 0-15.1 13.6-17.9 26.4-17.9v4.1zm17.9 43.3c-1.2 1-2.9 1.1-4.2.4-5.9-4.9-7-7.2-10.2-11.9-9.8 10-16.7 12.9-29.4 12.9C13.8 96.7 2 87.3 2 69 2 54.4 9.9 44.6 21.1 39.7c9.7-4.3 23.2-5.1 33.5-6.3v-2.3c0-4.3.3-9.4-2.2-13.1-2.2-3.3-6.3-4.7-10-4.7-6.8 0-12.9 3.5-14.4 10.7-.3 1.6-1.5 3.2-3.2 3.3L8 25.5c-1.5-.3-3.2-1.5-2.8-3.8C9.4 0 29 -6.6 46.7-6.6c9 0 20.8 2.4 27.9 9.2 9 8.4 8.1 19.7 8.1 31.9v28.9c0 8.7 3.6 12.5 7 17.2 1.2 1.7 1.4 3.7 0 4.9-3.7 3.1-10.3 8.8-13.9 12z"/>
            </svg>
            Buy 1 bag on Amazon →
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ background: "#1B2A4A", color: "rgba(255,255,255,0.6)", textAlign: "center", padding: "24px 20px", fontSize: 12 }}>
        <p style={{ margin: 0 }}>
          © 2026 USA Gummies ·{" "}
          <a href="https://www.usagummies.com" style={{ color: "rgba(255,255,255,0.8)", textDecoration: "none" }}>usagummies.com</a>
          {" "}· Made with 🇺🇸 in America
        </p>
      </footer>
    </div>
  );
}
