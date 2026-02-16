// src/app/vs/page.tsx
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { competitors } from "@/data/competitors";

export const metadata: Metadata = {
  title: "USA Gummies vs Other Brands — Side-by-Side Ingredient Comparisons",
  description:
    "Compare USA Gummies to Haribo, Trolli, Sour Patch Kids, Skittles, Nerds, and more. See the ingredient and manufacturing differences side by side.",
  openGraph: {
    title: "USA Gummies vs Other Brands — Side-by-Side Ingredient Comparisons",
    description:
      "Compare USA Gummies to Haribo, Trolli, Sour Patch Kids, Skittles, Nerds, and more. See the ingredient and manufacturing differences side by side.",
    url: "https://www.usagummies.com/vs",
    images: [{ url: "/opengraph-image", alt: "USA Gummies comparison" }],
  },
};

export default function VsIndexPage() {
  return (
    <div className="vs-root">
      <style>{`
        .vs-root {
          min-height: 100vh;
          background: #f8f5ef !important;
          color: #1B2A4A;
          font-family: var(--font-sans), 'Space Grotesk', system-ui, sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        .vs-root * { box-sizing: border-box; }
        .vs-display {
          font-family: var(--font-display), 'Oswald', sans-serif;
        }
        @keyframes vs-fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .vs-animate { animation: vs-fadeUp 0.8s ease-out both; }
        .vs-animate-d1 { animation: vs-fadeUp 0.8s 0.1s ease-out both; }
        .vs-animate-d2 { animation: vs-fadeUp 0.8s 0.2s ease-out both; }
        .vs-card:hover {
          border-color: #c7362c !important;
          box-shadow: 0 8px 24px rgba(27,42,74,0.08) !important;
          transform: translateY(-2px);
        }
      `}</style>

      {/* Header */}
      <header
        style={{
          background: "rgba(255,255,255,0.96)",
          borderBottom: "1px solid rgba(15,27,45,0.12)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div
          style={{
            maxWidth: 960,
            margin: "0 auto",
            padding: "12px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Link
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              textDecoration: "none",
            }}
          >
            <Image
              src="/brand/logo.png"
              alt="USA Gummies logo"
              width={120}
              height={40}
              style={{ height: 36, width: "auto", objectFit: "contain" }}
              priority
            />
            <span
              style={{
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "#1B2A4A",
              }}
            >
              Made in the USA
            </span>
          </Link>
          <Link
            href="/go"
            className="vs-display"
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
            SHOP NOW
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="vs-animate" style={{ maxWidth: 800, margin: "0 auto", padding: "48px 20px 32px", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 16 }}>
          <span
            className="vs-display"
            style={{
              background: "#1B2A4A",
              color: "#fff",
              padding: "5px 14px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "1px",
            }}
          >
            INGREDIENT COMPARISONS
          </span>
        </div>
        <h1
          className="vs-display"
          style={{
            fontSize: "clamp(32px, 5vw, 48px)",
            lineHeight: 1.1,
            color: "#1B2A4A",
            margin: 0,
          }}
        >
          How USA Gummies Compares
        </h1>
        <p
          style={{
            fontSize: 16,
            lineHeight: 1.6,
            color: "#5f5b56",
            maxWidth: 560,
            margin: "16px auto 0",
          }}
        >
          Side-by-side ingredient and manufacturing comparisons between
          USA Gummies and major candy brands. All information sourced from
          publicly available product labels.
        </p>
      </section>

      {/* Competitor Grid */}
      <section className="vs-animate-d1" style={{ maxWidth: 800, margin: "0 auto", padding: "0 20px 48px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {competitors.map((comp) => (
            <Link
              key={comp.slug}
              href={`/vs/${comp.slug}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div
                className="vs-card"
                style={{
                  background: "#ffffff",
                  border: "2px solid #e0dcd6",
                  borderRadius: 16,
                  padding: "24px 20px",
                  transition: "border-color 0.2s, box-shadow 0.2s, transform 0.15s",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                  }}
                >
                  <h2
                    className="vs-display"
                    style={{
                      fontSize: 22,
                      letterSpacing: "0.5px",
                      margin: 0,
                      color: "#1B2A4A",
                    }}
                  >
                    vs {comp.name}
                  </h2>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#5f5b56",
                      background: "#f8f5ef",
                      padding: "3px 10px",
                      borderRadius: 20,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {comp.parentCountry.split("(")[0].trim()}
                  </span>
                </div>

                <p
                  style={{
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: "#5f5b56",
                    margin: "10px 0 14px",
                  }}
                >
                  {comp.shortDescription}
                </p>

                {/* Quick chips */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {comp.artificialColors && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#c7362c",
                        background: "rgba(199,54,44,0.08)",
                        padding: "3px 10px",
                        borderRadius: 20,
                      }}
                    >
                      Artificial Colors
                    </span>
                  )}
                  {comp.titaniumDioxide && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#c7362c",
                        background: "rgba(199,54,44,0.08)",
                        padding: "3px 10px",
                        borderRadius: 20,
                      }}
                    >
                      Titanium Dioxide
                    </span>
                  )}
                  {!comp.madeInUSA && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#5f5b56",
                        background: "rgba(95,91,86,0.08)",
                        padding: "3px 10px",
                        borderRadius: 20,
                      }}
                    >
                      Not Made in USA
                    </span>
                  )}
                </div>

                <div
                  className="vs-display"
                  style={{
                    marginTop: 16,
                    fontSize: 13,
                    letterSpacing: "0.5px",
                    color: "#c7362c",
                    fontWeight: 700,
                  }}
                >
                  VIEW COMPARISON →
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section
        className="vs-animate-d2"
        style={{
          background: "#ffffff",
          borderTop: "1px solid #e0dcd6",
          padding: "40px 20px",
          textAlign: "center",
        }}
      >
        <h2
          className="vs-display"
          style={{ fontSize: 28, color: "#1B2A4A", margin: 0 }}
        >
          Ready to Try the Difference?
        </h2>
        <p
          style={{
            fontSize: 15,
            lineHeight: 1.6,
            color: "#5f5b56",
            maxWidth: 480,
            margin: "10px auto 20px",
          }}
        >
          All natural flavors, no artificial dyes, made in the USA.
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            maxWidth: 360,
            margin: "0 auto",
          }}
        >
          <Link
            href="/go"
            className="vs-display"
            style={{
              display: "block",
              width: "100%",
              padding: "16px",
              background: "#c7362c",
              color: "#ffffff",
              fontSize: 20,
              letterSpacing: "1.5px",
              textAlign: "center",
              border: "none",
              borderRadius: 12,
              cursor: "pointer",
              textDecoration: "none",
              transition: "background 0.2s",
            }}
          >
            SHOP USA GUMMIES
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer
        style={{
          background: "#1B2A4A",
          color: "rgba(255,255,255,0.6)",
          textAlign: "center",
          padding: "24px 20px",
          fontSize: 12,
        }}
      >
        <p style={{ margin: 0 }}>
          &copy; 2026 USA Gummies &middot;{" "}
          <a
            href="https://www.usagummies.com"
            style={{ color: "rgba(255,255,255,0.8)", textDecoration: "none" }}
          >
            usagummies.com
          </a>
          {" "}&middot; Made with 🇺🇸 in America
        </p>
      </footer>
    </div>
  );
}
