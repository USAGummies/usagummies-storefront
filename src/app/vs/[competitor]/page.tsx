// src/app/vs/[competitor]/page.tsx
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  competitors,
  getCompetitorBySlug,
  getAllCompetitorSlugs,
  usaGummies,
  whyItMattersItems,
} from "@/data/competitors";
import { AMAZON_LISTING_URL } from "@/lib/amazon";

// ---------------------------------------------------------------------------
// Static generation
// ---------------------------------------------------------------------------

export function generateStaticParams() {
  return getAllCompetitorSlugs().map((slug) => ({ competitor: slug }));
}

// ---------------------------------------------------------------------------
// Dynamic metadata
// ---------------------------------------------------------------------------

type PageProps = { params: Promise<{ competitor: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { competitor: slug } = await params;
  const comp = getCompetitorBySlug(slug);
  if (!comp) return {};

  const title = `USA Gummies vs ${comp.name} — Ingredients, Manufacturing & Ownership Compared`;
  const description = `Side-by-side comparison of USA Gummies and ${comp.name}. Compare artificial colors, titanium dioxide, manufacturing country, and parent company ownership.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `https://www.usagummies.com/vs/${slug}`,
      images: [{ url: "/opengraph-image", alt: `USA Gummies vs ${comp.name}` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    alternates: {
      canonical: `https://www.usagummies.com/vs/${slug}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function Check() {
  return (
    <span
      style={{
        color: "#2D7A3A",
        fontSize: 22,
        fontWeight: 700,
        lineHeight: 1,
      }}
      aria-label="Yes"
    >
      &#10003;
    </span>
  );
}

function Cross() {
  return (
    <span
      style={{
        color: "#c7362c",
        fontSize: 22,
        fontWeight: 700,
        lineHeight: 1,
      }}
      aria-label="No"
    >
      &#10007;
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default async function CompetitorPage({ params }: PageProps) {
  const { competitor: slug } = await params;
  const comp = getCompetitorBySlug(slug);
  if (!comp) notFound();

  // Current date for the disclaimer
  const currentDate = new Date().toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Build structured data: Product + FAQ
  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "USA Gummies All American Gummy Bears",
    description:
      "All natural gummy bears made in the USA with no artificial dyes and no titanium dioxide.",
    brand: { "@type": "Brand", name: "USA Gummies" },
    offers: {
      "@type": "AggregateOffer",
      lowPrice: "5.00",
      highPrice: "5.99",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
    countryOfOrigin: { "@type": "Country", name: "United States" },
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: whyItMattersItems.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };

  // Related competitors (up to 3, excluding current)
  const related = competitors
    .filter((c) => c.slug !== slug)
    .slice(0, 3);

  // Comparison rows
  const rows: Array<{
    label: string;
    usaValue: React.ReactNode;
    compValue: React.ReactNode;
    /** true when USA Gummies "wins" this row */
    highlight?: boolean;
  }> = [
    {
      label: "Made in USA",
      usaValue: <Check />,
      compValue: comp.madeInUSA ? <Check /> : <Cross />,
      highlight: !comp.madeInUSA,
    },
    {
      label: "Free of Artificial Colors",
      usaValue: <Check />,
      compValue: comp.artificialColors ? <Cross /> : <Check />,
      highlight: comp.artificialColors,
    },
    {
      label: "Titanium Dioxide Free",
      usaValue: <Check />,
      compValue: comp.titaniumDioxide ? <Cross /> : <Check />,
      highlight: comp.titaniumDioxide,
    },
    {
      label: "Natural Flavors",
      usaValue: <Check />,
      compValue: comp.naturalFlavors ? <Check /> : <Cross />,
      highlight: !comp.naturalFlavors,
    },
    {
      label: "American-Owned",
      usaValue: <Check />,
      compValue: comp.americanOwned ? <Check /> : <Cross />,
      highlight: !comp.americanOwned,
    },
    {
      label: "Parent Company",
      usaValue: (
        <span style={{ fontSize: 13 }}>{usaGummies.parentCompany}</span>
      ),
      compValue: (
        <span style={{ fontSize: 13 }}>
          {comp.parentCompany} ({comp.parentCountry})
        </span>
      ),
    },
    {
      label: "Where Manufactured",
      usaValue: <span style={{ fontSize: 13 }}>{usaGummies.madeIn}</span>,
      compValue: <span style={{ fontSize: 13 }}>{comp.madeIn}</span>,
    },
  ];

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
        .vs-animate-d3 { animation: vs-fadeUp 0.8s 0.3s ease-out both; }
        .vs-cta {
          display: block;
          width: 100%;
          padding: 18px;
          background: #c7362c;
          color: #ffffff;
          font-family: var(--font-display), 'Oswald', sans-serif;
          font-size: 20px;
          letter-spacing: 1.5px;
          text-align: center;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          text-decoration: none;
          transition: background 0.2s, transform 0.15s;
        }
        .vs-cta:hover {
          background: #a82920;
          transform: translateY(-1px);
        }
        .vs-amazon-cta {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          padding: 14px 24px;
          background: #ffffff;
          border: 2px solid #1B2A4A;
          border-radius: 12px;
          color: #1B2A4A;
          font-family: var(--font-display), 'Oswald', sans-serif;
          font-size: 16px;
          letter-spacing: 1px;
          text-decoration: none;
          cursor: pointer;
          transition: background 0.2s, border-color 0.2s, transform 0.15s;
        }
        .vs-amazon-cta:hover {
          background: #f0ede6;
          border-color: #c7362c;
          transform: translateY(-1px);
        }
        .vs-table-row {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          border-bottom: 1px solid #e0dcd6;
        }
        .vs-table-cell {
          padding: 14px 12px;
          font-size: 14px;
          display: flex;
          align-items: center;
        }
        @media (max-width: 600px) {
          .vs-table-cell { font-size: 12px; padding: 10px 8px; }
        }
      `}</style>

      {/* Structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

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

      {/* Breadcrumb */}
      <nav
        className="vs-animate"
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "16px 20px 0",
          fontSize: 13,
          color: "#5f5b56",
        }}
      >
        <Link href="/" style={{ color: "#5f5b56", textDecoration: "none" }}>
          Home
        </Link>
        {" / "}
        <Link href="/vs" style={{ color: "#5f5b56", textDecoration: "none" }}>
          Comparisons
        </Link>
        {" / "}
        <span style={{ color: "#1B2A4A", fontWeight: 600 }}>
          vs {comp.name}
        </span>
      </nav>

      {/* ============================================================= */}
      {/* HERO SECTION                                                   */}
      {/* ============================================================= */}
      <section
        className="vs-animate"
        style={{
          maxWidth: 800,
          margin: "0 auto",
          padding: "32px 20px 24px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 6,
            marginBottom: 14,
            flexWrap: "wrap",
          }}
        >
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
            SIDE-BY-SIDE COMPARISON
          </span>
          <span
            className="vs-display"
            style={{
              background: "#2D7A3A",
              color: "#fff",
              padding: "5px 14px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "1px",
            }}
          >
            INGREDIENT FACTS
          </span>
        </div>

        <h1
          className="vs-display"
          style={{
            fontSize: "clamp(30px, 5vw, 48px)",
            lineHeight: 1.1,
            color: "#1B2A4A",
            margin: 0,
          }}
        >
          USA Gummies vs {comp.name}
        </h1>
        <p
          style={{
            fontSize: 16,
            lineHeight: 1.6,
            color: "#5f5b56",
            maxWidth: 560,
            margin: "14px auto 0",
          }}
        >
          A factual, side-by-side comparison of ingredients, manufacturing
          origin, and company ownership to help you make an informed choice.
        </p>
      </section>

      {/* ============================================================= */}
      {/* COMPARISON TABLE                                               */}
      {/* ============================================================= */}
      <section
        className="vs-animate-d1"
        style={{ maxWidth: 800, margin: "0 auto", padding: "0 20px 32px" }}
      >
        <div
          style={{
            background: "#ffffff",
            borderRadius: 16,
            border: "2px solid #e0dcd6",
            overflow: "hidden",
            boxShadow: "0 4px 16px rgba(27,42,74,0.06)",
          }}
        >
          {/* Table header */}
          <div
            className="vs-table-row"
            style={{
              background: "#1B2A4A",
              color: "#ffffff",
              borderBottom: "none",
            }}
          >
            <div className="vs-table-cell" style={{ fontWeight: 700, fontSize: 13 }}>
              &nbsp;
            </div>
            <div
              className="vs-table-cell vs-display"
              style={{
                fontWeight: 700,
                fontSize: 15,
                letterSpacing: "0.5px",
                justifyContent: "center",
              }}
            >
              USA Gummies
            </div>
            <div
              className="vs-table-cell vs-display"
              style={{
                fontWeight: 700,
                fontSize: 15,
                letterSpacing: "0.5px",
                justifyContent: "center",
              }}
            >
              {comp.name}
            </div>
          </div>

          {/* Table rows */}
          {rows.map((row, i) => (
            <div
              key={row.label}
              className="vs-table-row"
              style={{
                background: i % 2 === 0 ? "#ffffff" : "#faf8f4",
              }}
            >
              <div
                className="vs-table-cell"
                style={{ fontWeight: 600, color: "#1B2A4A" }}
              >
                {row.label}
              </div>
              <div
                className="vs-table-cell"
                style={{
                  justifyContent: "center",
                  background: row.highlight
                    ? "rgba(45,122,58,0.06)"
                    : undefined,
                }}
              >
                {row.usaValue}
              </div>
              <div
                className="vs-table-cell"
                style={{
                  justifyContent: "center",
                  background: row.highlight
                    ? "rgba(199,54,44,0.04)"
                    : undefined,
                }}
              >
                {row.compValue}
              </div>
            </div>
          ))}

          {/* Notable ingredients row */}
          {comp.notableIngredients && comp.notableIngredients.length > 0 && (
            <div
              style={{
                padding: "16px 12px",
                borderTop: "1px solid #e0dcd6",
                background: "#faf8f4",
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 13,
                  color: "#1B2A4A",
                  marginBottom: 8,
                }}
              >
                Notable Ingredients of Concern in {comp.name}:
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                }}
              >
                {comp.notableIngredients.map((ingredient) => (
                  <span
                    key={ingredient}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#c7362c",
                      background: "rgba(199,54,44,0.08)",
                      padding: "4px 10px",
                      borderRadius: 20,
                    }}
                  >
                    {ingredient}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Dual standard callout */}
        {comp.dualStandard && (
          <div
            style={{
              marginTop: 16,
              padding: "16px 20px",
              background: "rgba(199,160,98,0.08)",
              border: "1px solid rgba(199,160,98,0.25)",
              borderRadius: 12,
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#1B2A4A",
                marginBottom: 4,
              }}
            >
              Dual Standard Note:
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: "#5f5b56" }}>
              {comp.dualStandard}
            </div>
          </div>
        )}
      </section>

      {/* ============================================================= */}
      {/* WHY IT MATTERS                                                 */}
      {/* ============================================================= */}
      <section
        className="vs-animate-d2"
        style={{
          background: "#ffffff",
          borderTop: "1px solid #e0dcd6",
          borderBottom: "1px solid #e0dcd6",
          padding: "40px 20px",
        }}
      >
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <h2
            className="vs-display"
            style={{
              fontSize: 28,
              color: "#1B2A4A",
              textAlign: "center",
              margin: "0 0 24px",
            }}
          >
            Why It Matters
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {whyItMattersItems.map((item) => (
              <details
                key={item.question}
                style={{
                  background: "#f8f5ef",
                  border: "1px solid #e0dcd6",
                  borderRadius: 12,
                  overflow: "hidden",
                }}
              >
                <summary
                  style={{
                    padding: "16px 20px",
                    fontWeight: 700,
                    fontSize: 15,
                    color: "#1B2A4A",
                    cursor: "pointer",
                    listStyle: "none",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>{item.question}</span>
                  <span
                    style={{
                      fontSize: 20,
                      color: "#5f5b56",
                      marginLeft: 12,
                      flexShrink: 0,
                    }}
                  >
                    +
                  </span>
                </summary>
                <div
                  style={{
                    padding: "0 20px 16px",
                    fontSize: 14,
                    lineHeight: 1.65,
                    color: "#5f5b56",
                  }}
                >
                  {item.answer}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================= */}
      {/* CTA SECTION                                                    */}
      {/* ============================================================= */}
      <section
        className="vs-animate-d3"
        style={{
          maxWidth: 560,
          margin: "0 auto",
          padding: "40px 20px 32px",
          textAlign: "center",
        }}
      >
        <h2
          className="vs-display"
          style={{ fontSize: 26, color: "#1B2A4A", margin: "0 0 6px" }}
        >
          Try USA Gummies
        </h2>
        <p
          style={{
            fontSize: 15,
            lineHeight: 1.6,
            color: "#5f5b56",
            maxWidth: 440,
            margin: "0 auto 20px",
          }}
        >
          All natural flavors, no artificial dyes, no titanium dioxide. Made in
          the USA by an independent American business.
        </p>

        <div
          style={{
            background: "#ffffff",
            border: "2px solid #c7362c",
            borderRadius: 16,
            padding: "20px 20px 24px",
            position: "relative",
            overflow: "hidden",
            textAlign: "left",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 4,
              background:
                "linear-gradient(90deg, #c7362c, #1B2A4A, #c7362c)",
            }}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <span
              className="vs-display"
              style={{
                fontSize: 20,
                letterSpacing: "1px",
                color: "#1B2A4A",
              }}
            >
              5-BAG BUNDLE
            </span>
            <span
              style={{
                background: "#c7362c",
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 10px",
                borderRadius: 20,
              }}
            >
              BEST DEAL
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              marginTop: 4,
            }}
          >
            <span
              className="vs-display"
              style={{ fontSize: 38, color: "#1B2A4A", lineHeight: 1 }}
            >
              $25.00
            </span>
            <span
              style={{
                textDecoration: "line-through",
                fontSize: 16,
                color: "#999",
                fontWeight: 500,
              }}
            >
              $29.95
            </span>
          </div>
          <div
            style={{
              fontSize: 13,
              color: "#2D7A3A",
              fontWeight: 700,
              marginTop: 2,
            }}
          >
            You save $4.95 &mdash; free shipping included
          </div>

          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: 10,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#1B2A4A",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span style={{ color: "#2D7A3A", fontSize: 15 }}>&#10003;</span>{" "}
              No artificial dyes
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#1B2A4A",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span style={{ color: "#2D7A3A", fontSize: 15 }}>&#10003;</span>{" "}
              Made in the USA
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#1B2A4A",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span style={{ color: "#2D7A3A", fontSize: 15 }}>&#10003;</span>{" "}
              All natural flavors
            </span>
          </div>

          <Link href="/go" className="vs-cta" style={{ marginTop: 16 }}>
            GET THE 5-PACK &mdash; $25 TOTAL
          </Link>

          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 6,
              marginTop: 10,
              fontSize: 11,
              color: "#5f5b56",
              fontWeight: 500,
            }}
          >
            <span>🔒</span>
            <span>
              Family-owned American business &middot; 100% satisfaction
              guarantee
            </span>
          </div>
        </div>

        <a
          href={AMAZON_LISTING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="vs-amazon-cta"
          style={{ marginTop: 12 }}
        >
          <span>Or Buy on Amazon</span>
          <span style={{ fontSize: 14 }}>&rarr;</span>
        </a>
      </section>

      {/* ============================================================= */}
      {/* RELATED COMPARISONS                                            */}
      {/* ============================================================= */}
      <section
        style={{
          background: "#ffffff",
          borderTop: "1px solid #e0dcd6",
          padding: "36px 20px",
        }}
      >
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <h2
            className="vs-display"
            style={{
              fontSize: 22,
              color: "#1B2A4A",
              textAlign: "center",
              margin: "0 0 20px",
              letterSpacing: "0.5px",
            }}
          >
            More Comparisons
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            {related.map((rel) => (
              <Link
                key={rel.slug}
                href={`/vs/${rel.slug}`}
                style={{
                  textDecoration: "none",
                  color: "inherit",
                  display: "block",
                  background: "#f8f5ef",
                  border: "1px solid #e0dcd6",
                  borderRadius: 12,
                  padding: "16px",
                  transition: "border-color 0.2s, transform 0.15s",
                }}
              >
                <span
                  className="vs-display"
                  style={{
                    fontSize: 16,
                    color: "#1B2A4A",
                    letterSpacing: "0.5px",
                  }}
                >
                  vs {rel.name}
                </span>
                <div
                  style={{
                    fontSize: 12,
                    color: "#5f5b56",
                    marginTop: 4,
                  }}
                >
                  {rel.parentCountry.split("(")[0].trim()} &middot;{" "}
                  {rel.artificialColors
                    ? "Contains artificial colors"
                    : "No artificial colors"}
                </div>
              </Link>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <Link
              href="/vs"
              className="vs-display"
              style={{
                fontSize: 14,
                letterSpacing: "0.5px",
                color: "#c7362c",
                textDecoration: "none",
                fontWeight: 700,
              }}
            >
              VIEW ALL COMPARISONS &rarr;
            </Link>
          </div>
        </div>
      </section>

      {/* ============================================================= */}
      {/* LEGAL DISCLAIMER                                               */}
      {/* ============================================================= */}
      <section
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "24px 20px 16px",
        }}
      >
        <div
          style={{
            background: "#f0ede6",
            borderRadius: 12,
            padding: "16px 20px",
            fontSize: 12,
            lineHeight: 1.6,
            color: "#5f5b56",
          }}
        >
          <strong style={{ color: "#1B2A4A" }}>Disclaimer:</strong> All
          ingredient information on this page is sourced from publicly available
          product labels and manufacturer disclosures. This comparison reflects
          products available as of {currentDate}. Formulations may change without
          notice. We encourage consumers to read product labels for the most
          current information. This page is intended for informational purposes
          only and does not constitute health or dietary advice.
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
            style={{
              color: "rgba(255,255,255,0.8)",
              textDecoration: "none",
            }}
          >
            usagummies.com
          </a>
          {" "}&middot; Made with 🇺🇸 in America
        </p>
      </footer>
    </div>
  );
}
