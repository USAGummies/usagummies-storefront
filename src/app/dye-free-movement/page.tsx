// src/app/dye-free-movement/page.tsx
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { LeadCapture } from "@/components/marketing/LeadCapture.client";

const SITE_URL = "https://www.usagummies.com";

export const metadata: Metadata = {
  title: "The Dye-Free Movement — A Timeline of Candy Without Artificial Colors",
  description:
    "From the EU's warning labels to the FDA's Red No. 3 ban: a complete timeline of the movement to remove artificial dyes from candy. See which brands led and which followed.",
  alternates: { canonical: `${SITE_URL}/dye-free-movement` },
  keywords: [
    "dye free candy timeline",
    "artificial dye ban history",
    "Red No 3 ban",
    "food dye removal candy",
    "dye free candy brands",
    "natural color candy",
    "Red 40 free candy",
    "candy without artificial dyes",
    "Mars removing dyes",
    "FDA food dye ban 2025",
  ],
  openGraph: {
    title: "The Dye-Free Movement — A Timeline of Candy Without Artificial Colors",
    description:
      "From the EU's warning labels to the FDA's Red No. 3 ban: a complete timeline of the movement to remove artificial dyes from candy.",
    url: `${SITE_URL}/dye-free-movement`,
    siteName: "USA Gummies",
    type: "article",
    images: [{ url: "/opengraph-image", alt: "Dye-Free Movement Timeline" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "The Dye-Free Movement — Timeline of Candy Without Artificial Colors",
    description:
      "From EU warning labels to the FDA Red No. 3 ban — see which candy brands led the dye-free shift and which are still catching up.",
    images: ["/opengraph-image"],
  },
};

const TIMELINE: {
  year: string;
  title: string;
  description: string;
  category: "regulation" | "industry" | "usa-gummies" | "science";
}[] = [
  {
    year: "2007",
    title: "UK Study Links Dyes to Hyperactivity",
    description:
      "A University of Southampton study funded by the UK Food Standards Agency finds that mixtures of artificial food dyes and sodium benzoate may increase hyperactive behavior in children. The study is published in The Lancet.",
    category: "science",
  },
  {
    year: "2010",
    title: "EU Requires Warning Labels on Dyed Foods",
    description:
      'The European Union begins requiring foods containing six artificial dyes to carry labels warning they "may have an adverse effect on activity and attention in children." Many manufacturers reformulate rather than add the warning.',
    category: "regulation",
  },
  {
    year: "2011",
    title: "FDA Reviews Dye Safety, Decides Against Warning Labels",
    description:
      "An FDA advisory panel reviews the evidence on artificial dyes and hyperactivity. The panel votes against recommending warning labels for the US market, saying available data is insufficient to establish a causal link.",
    category: "regulation",
  },
  {
    year: "2015",
    title: "Nestlé Removes Artificial Colors from Chocolate",
    description:
      "Nestlé USA announces it will remove artificial colors and flavors from all its chocolate candy products, including Butterfinger and Baby Ruth. They switch to natural alternatives like annatto and paprika.",
    category: "industry",
  },
  {
    year: "2016",
    title: "Mars Pledges to Remove Artificial Dyes Within 5 Years",
    description:
      "Mars Inc. announces plans to remove all artificial colors from its food products within five years. The company states it will use natural alternatives. The pledge is later walked back.",
    category: "industry",
  },
  {
    year: "2016",
    title: "General Mills Goes Natural on Cereal",
    description:
      "General Mills removes artificial colors and flavors from its entire cereal portfolio, including Trix and Lucky Charms. Trix temporarily loses its bright neon colors in favor of muted, naturally-derived tones.",
    category: "industry",
  },
  {
    year: "2021",
    title: "California Introduces School Dye Ban Bill",
    description:
      'California introduces legislation to ban artificial food dyes from school meals. While it doesn\'t pass initially, it signals growing state-level regulatory interest in dyes beyond the "voluntary" approach.',
    category: "regulation",
  },
  {
    year: "2023",
    title: "California Bans Red No. 3 from Food",
    description:
      "California becomes the first US state to ban Red No. 3 (erythrosine) from food products, along with three other additives. The law gives manufacturers until 2027 to comply.",
    category: "regulation",
  },
  {
    year: "2024",
    title: "USA Gummies Launches Dye-Free from Day One",
    description:
      "USA Gummies enters the market with gummy bears made without any artificial dyes, using colors from fruit and vegetable extracts, spirulina, and turmeric. All products are manufactured in the United States.",
    category: "usa-gummies",
  },
  {
    year: "2025",
    title: "FDA Bans Red No. 3 Nationwide",
    description:
      "The FDA officially bans Red No. 3 from food products across the United States, with full removal required by January 2027. The agency also encourages industry to phase out Red No. 40.",
    category: "regulation",
  },
  {
    year: "2025",
    title: "FDA Approves Three Natural Color Additives",
    description:
      "In May 2025, the FDA approves three new color additives from natural sources, giving food manufacturers more options for replacing synthetic dyes with plant-derived alternatives.",
    category: "regulation",
  },
  {
    year: "2025",
    title: 'RFK Jr. Launches "Make America Healthy Again"',
    description:
      "Health and Human Services Secretary Robert F. Kennedy Jr. pushes to crack down on synthetic food additives, including proposals to phase out artificial food dyes in favor of natural alternatives.",
    category: "regulation",
  },
  {
    year: "2025",
    title: "Kraft Heinz and General Mills Announce Dye Removal",
    description:
      "In June 2025, Kraft Heinz and General Mills announce plans to remove artificial food dyes from some products within two years. Other major food companies follow with similar announcements.",
    category: "industry",
  },
  {
    year: "2025",
    title: "Mars Announces Dye-Free Options for 2026",
    description:
      "Mars Wrigley announces it will offer M&M's, Skittles, Starburst, and Extra Gum without synthetic dyes starting in 2026. These are additional options — existing dyed versions remain available.",
    category: "industry",
  },
  {
    year: "2025",
    title: "Industry-Wide Shift Accelerates",
    description:
      "PepsiCo, ConAgra, The Hershey Company, McCormick, J.M. Smucker, and Nestlé USA all announce plans to reduce or eliminate artificial dyes. The shift that started in Europe 15 years earlier reaches critical mass in the US.",
    category: "industry",
  },
];

const CATEGORY_STYLES: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  regulation: { bg: "rgba(27,42,74,0.08)", text: "#1B2A4A", label: "Regulation" },
  industry: { bg: "rgba(199,54,44,0.08)", text: "#c7362c", label: "Industry" },
  "usa-gummies": { bg: "rgba(45,122,58,0.08)", text: "#2D7A3A", label: "USA Gummies" },
  science: { bg: "rgba(95,91,86,0.08)", text: "#5f5b56", label: "Research" },
};

const BRANDS_TIMELINE = [
  { name: "Nestlé USA", year: 2015, note: "Removed from chocolate candy" },
  { name: "General Mills", year: 2016, note: "Removed from cereals" },
  { name: "USA Gummies", year: 2024, note: "Launched dye-free from day one", highlight: true },
  { name: "Kraft Heinz", year: 2025, note: "Announced removal plans" },
  { name: "General Mills", year: 2025, note: "Announced candy removal plans" },
  { name: "PepsiCo", year: 2025, note: "Announced removal plans" },
  { name: "Hershey", year: 2025, note: "Announced removal plans" },
  { name: "Mars Wrigley", year: 2026, note: "Dye-free options (not full removal)" },
];

const jsonLdArticle = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "The Dye-Free Movement — A Timeline of Candy Without Artificial Colors",
  description:
    "From the EU's warning labels to the FDA's Red No. 3 ban: a complete timeline of the movement to remove artificial dyes from candy.",
  url: `${SITE_URL}/dye-free-movement`,
  image: `${SITE_URL}/opengraph-image`,
  datePublished: "2026-02-15",
  dateModified: "2026-02-15",
  author: { "@type": "Organization", name: "USA Gummies", url: SITE_URL },
  publisher: {
    "@type": "Organization",
    name: "USA Gummies",
    url: SITE_URL,
    logo: { "@type": "ImageObject", url: `${SITE_URL}/brand/logo.png` },
  },
  mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}/dye-free-movement` },
};

const jsonLdBreadcrumb = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
    { "@type": "ListItem", position: 2, name: "Dye-Free Candy", item: `${SITE_URL}/dye-free-candy` },
    { "@type": "ListItem", position: 3, name: "The Dye-Free Movement", item: `${SITE_URL}/dye-free-movement` },
  ],
};

export default function DyeFreeMovementPage() {
  return (
    <div className="vs-root">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdArticle) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdBreadcrumb) }}
      />
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
        .timeline-line {
          position: absolute;
          left: 20px;
          top: 0;
          bottom: 0;
          width: 2px;
          background: linear-gradient(to bottom, #e0dcd6, #c7362c, #2D7A3A);
        }
        @media (min-width: 640px) {
          .timeline-line { left: 28px; }
        }
        .timeline-dot {
          position: absolute;
          left: 14px;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          border: 3px solid #f8f5ef;
          top: 6px;
        }
        @media (min-width: 640px) {
          .timeline-dot { left: 22px; }
        }
        .timeline-entry:hover .timeline-card {
          border-color: #c7362c !important;
          box-shadow: 0 4px 16px rgba(27,42,74,0.06) !important;
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
      <section
        className="vs-animate"
        style={{
          maxWidth: 800,
          margin: "0 auto",
          padding: "48px 20px 16px",
          textAlign: "center",
        }}
      >
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
            THE DYE-FREE MOVEMENT
          </span>
        </div>
        <h1
          className="vs-display"
          style={{
            fontSize: "clamp(28px, 5vw, 44px)",
            lineHeight: 1.1,
            color: "#1B2A4A",
            margin: 0,
          }}
        >
          How Candy Went From Neon to Natural
        </h1>
        <p
          style={{
            fontSize: 16,
            lineHeight: 1.6,
            color: "#5f5b56",
            maxWidth: 600,
            margin: "16px auto 0",
          }}
        >
          The timeline of artificial dye removal from candy — from the first European
          warning labels to the biggest US brands announcing reformulations. See who
          led and who followed.
        </p>
      </section>

      {/* Key Stats Bar */}
      <section className="vs-animate-d1" style={{ maxWidth: 800, margin: "0 auto", padding: "0 20px 32px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          {[
            { stat: "2007", label: "First major study on dyes & hyperactivity" },
            { stat: "2010", label: "EU requires warning labels" },
            { stat: "2025", label: "FDA bans Red No. 3" },
            { stat: "8+", label: "Major US brands now removing dyes" },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                background: "#ffffff",
                border: "2px solid #e0dcd6",
                borderRadius: 16,
                padding: "16px",
                textAlign: "center",
              }}
            >
              <div
                className="vs-display"
                style={{ fontSize: 28, color: "#c7362c", fontWeight: 700 }}
              >
                {item.stat}
              </div>
              <div style={{ fontSize: 12, color: "#5f5b56", marginTop: 4, lineHeight: 1.4 }}>
                {item.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Timeline */}
      <section className="vs-animate-d2" style={{ maxWidth: 800, margin: "0 auto", padding: "0 20px 48px" }}>
        <div style={{ position: "relative", paddingLeft: 48 }}>
          <div className="timeline-line" />

          {TIMELINE.map((entry, i) => {
            const style = CATEGORY_STYLES[entry.category];
            return (
              <div
                key={`${entry.year}-${i}`}
                className="timeline-entry"
                style={{
                  position: "relative",
                  marginBottom: 20,
                }}
              >
                <div
                  className="timeline-dot"
                  style={{
                    background:
                      entry.category === "usa-gummies"
                        ? "#2D7A3A"
                        : entry.category === "regulation"
                          ? "#1B2A4A"
                          : entry.category === "industry"
                            ? "#c7362c"
                            : "#5f5b56",
                  }}
                />
                <div
                  className="timeline-card"
                  style={{
                    background: "#ffffff",
                    border: entry.category === "usa-gummies" ? "2px solid #2D7A3A" : "2px solid #e0dcd6",
                    borderRadius: 16,
                    padding: "20px",
                    transition: "border-color 0.2s, box-shadow 0.2s",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <span
                      className="vs-display"
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: "#1B2A4A",
                      }}
                    >
                      {entry.year}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: style.text,
                        background: style.bg,
                        padding: "3px 10px",
                        borderRadius: 20,
                      }}
                    >
                      {style.label}
                    </span>
                  </div>
                  <h3
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      color: "#1B2A4A",
                      margin: "0 0 6px",
                      lineHeight: 1.3,
                    }}
                  >
                    {entry.title}
                  </h3>
                  <p
                    style={{
                      fontSize: 14,
                      lineHeight: 1.6,
                      color: "#5f5b56",
                      margin: 0,
                    }}
                  >
                    {entry.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Who Led, Who Followed */}
      <section
        className="vs-animate-d3"
        style={{
          maxWidth: 800,
          margin: "0 auto",
          padding: "0 20px 48px",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <h2
            className="vs-display"
            style={{ fontSize: 28, color: "#1B2A4A", margin: 0 }}
          >
            Who Led. Who Followed.
          </h2>
          <p style={{ fontSize: 14, color: "#5f5b56", marginTop: 8 }}>
            When each brand acted on removing artificial dyes from candy.
          </p>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {BRANDS_TIMELINE.map((brand) => (
            <div
              key={`${brand.name}-${brand.year}`}
              style={{
                background: brand.highlight ? "rgba(45,122,58,0.06)" : "#ffffff",
                border: brand.highlight
                  ? "2px solid #2D7A3A"
                  : "2px solid #e0dcd6",
                borderRadius: 12,
                padding: "14px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  className="vs-display"
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: brand.highlight ? "#2D7A3A" : "#1B2A4A",
                    minWidth: 48,
                  }}
                >
                  {brand.year}
                </span>
                <div>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: brand.highlight ? "#2D7A3A" : "#1B2A4A",
                    }}
                  >
                    {brand.name}
                  </div>
                  <div style={{ fontSize: 13, color: "#5f5b56" }}>
                    {brand.note}
                  </div>
                </div>
              </div>
              {brand.highlight && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#2D7A3A",
                    background: "rgba(45,122,58,0.1)",
                    padding: "4px 12px",
                    borderRadius: 20,
                    whiteSpace: "nowrap",
                  }}
                >
                  ✓ Day One
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Email Capture */}
      <section
        style={{
          maxWidth: 800,
          margin: "0 auto",
          padding: "0 20px 48px",
        }}
      >
        <div
          style={{
            background: "#1B2A4A",
            borderRadius: 20,
            padding: "32px 24px",
            textAlign: "center",
          }}
        >
          <h2
            className="vs-display"
            style={{
              fontSize: 24,
              color: "#ffffff",
              margin: "0 0 8px",
            }}
          >
            Stay Ahead of the Dye-Free Movement
          </h2>
          <p
            style={{
              fontSize: 14,
              color: "rgba(255,255,255,0.7)",
              margin: "0 auto 20px",
              maxWidth: 440,
              lineHeight: 1.5,
            }}
          >
            Get ingredient news, label-reading tips, and first access to new
            USA Gummies flavors. No spam — just the stuff that matters.
          </p>
          <div style={{ maxWidth: 400, margin: "0 auto" }}>
            <LeadCapture
              source="dye-free-movement"
              intent="newsletter"
              title=""
              ctaLabel="Join the movement"
              variant="dark"
              emphasis="quiet"
              showSms={false}
            />
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section
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
          Don&apos;t Wait for 2027
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
          While the big brands are still announcing plans, USA Gummies has been
          dye-free since launch. All natural flavors, no artificial dyes, made in
          the USA.
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
          <Link
            href="/vs"
            className="vs-display"
            style={{
              display: "block",
              width: "100%",
              padding: "14px",
              background: "transparent",
              color: "#1B2A4A",
              fontSize: 14,
              letterSpacing: "1px",
              textAlign: "center",
              border: "2px solid #e0dcd6",
              borderRadius: 12,
              cursor: "pointer",
              textDecoration: "none",
            }}
          >
            VIEW BRAND COMPARISONS →
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
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 11,
            color: "rgba(255,255,255,0.4)",
          }}
        >
          Timeline events sourced from FDA announcements, news reports, and
          company press releases. All dates and facts are from publicly available
          information.
        </p>
      </footer>
    </div>
  );
}
