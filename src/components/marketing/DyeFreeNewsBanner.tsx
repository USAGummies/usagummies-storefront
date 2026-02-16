// src/components/marketing/DyeFreeNewsBanner.tsx
import Link from "next/link";

/**
 * News-jacking banner that capitalizes on the FDA Red No. 3 ban
 * and the broader dye-free movement. Positioned on the homepage
 * between value cards and blog section for maximum visibility.
 *
 * Server component — no client JS needed.
 */
export function DyeFreeNewsBanner() {
  return (
    <section
      aria-label="Dye-free movement news"
      data-zone="DYE-FREE-NEWS"
      style={{
        background: "linear-gradient(135deg, #fefcf7 0%, #f8f5ef 50%, #f0ebe0 100%)",
        borderTop: "1px solid rgba(27, 42, 74, 0.08)",
        borderBottom: "1px solid rgba(27, 42, 74, 0.08)",
      }}
    >
      <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        {/* Kicker */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "#c7362c",
              color: "#fff",
              fontSize: 10,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              padding: "3px 10px",
              borderRadius: 4,
            }}
          >
            <span aria-hidden="true">⚡</span>
            Breaking
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#1B2A4A",
              opacity: 0.6,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            The Dye-Free Movement
          </span>
        </div>

        {/* Main content grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 24,
          }}
          className="sm:!grid-cols-[1.3fr_0.7fr]"
        >
          {/* Left: News + context */}
          <div>
            <h2
              style={{
                fontSize: 24,
                fontWeight: 900,
                lineHeight: 1.15,
                color: "#1B2A4A",
                margin: 0,
                fontFamily: "var(--font-display), Oswald, sans-serif",
                textTransform: "uppercase",
              }}
              className="sm:!text-[28px] lg:!text-[32px]"
            >
              The FDA banned Red No.&nbsp;3.
              <br />
              <span style={{ color: "#c7362c" }}>
                We never used it.
              </span>
            </h2>
            <p
              style={{
                marginTop: 12,
                fontSize: 14,
                lineHeight: 1.6,
                color: "#1B2A4A",
                opacity: 0.8,
                maxWidth: 520,
              }}
            >
              Mars, Skittles, and Kraft are scrambling to remove artificial dyes.
              USA Gummies has been dye-free from day one — colored with real
              fruit and vegetable extracts, made entirely in the USA.
            </p>

            {/* News timeline pills */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 16,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#1B2A4A",
                  background: "#fff",
                  border: "1px solid rgba(27, 42, 74, 0.12)",
                  borderRadius: 20,
                  padding: "4px 12px",
                }}
              >
                <span style={{ color: "#2D7A3A" }} aria-hidden="true">✓</span>
                FDA bans Red No. 3
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#1B2A4A",
                  background: "#fff",
                  border: "1px solid rgba(27, 42, 74, 0.12)",
                  borderRadius: 20,
                  padding: "4px 12px",
                }}
              >
                <span style={{ color: "#2D7A3A" }} aria-hidden="true">✓</span>
                Mars drops artificial dyes
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#1B2A4A",
                  background: "#fff",
                  border: "1px solid rgba(27, 42, 74, 0.12)",
                  borderRadius: 20,
                  padding: "4px 12px",
                }}
              >
                <span style={{ color: "#2D7A3A" }} aria-hidden="true">✓</span>
                EU warning labels since 2010
              </span>
            </div>

            {/* CTAs */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 12,
                marginTop: 20,
              }}
            >
              <Link
                href="/shop"
                className="btn btn-candy"
                style={{
                  fontSize: 13,
                  padding: "10px 24px",
                }}
              >
                Shop dye-free gummies
              </Link>
              <Link
                href="/dye-free-movement"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#1B2A4A",
                  textDecoration: "underline",
                  textUnderlineOffset: 4,
                }}
              >
                See the full timeline →
              </Link>
            </div>
          </div>

          {/* Right: Quick fact card */}
          <div
            style={{
              background: "#fff",
              border: "1px solid rgba(27, 42, 74, 0.10)",
              borderRadius: 16,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.15em",
                color: "#1B2A4A",
                opacity: 0.5,
              }}
            >
              Why it matters
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span
                  style={{
                    flexShrink: 0,
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "#c7362c",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontWeight: 800,
                  }}
                >
                  1
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1B2A4A" }}>
                    Red No. 3 linked to cancer in animals
                  </div>
                  <div style={{ fontSize: 11, color: "#1B2A4A", opacity: 0.6, marginTop: 2 }}>
                    FDA banned it Jan 2025 after decades of evidence
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span
                  style={{
                    flexShrink: 0,
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "#c7362c",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontWeight: 800,
                  }}
                >
                  2
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1B2A4A" }}>
                    Red 40, Yellow 5, Blue 1 still legal
                  </div>
                  <div style={{ fontSize: 11, color: "#1B2A4A", opacity: 0.6, marginTop: 2 }}>
                    Require warning labels in Europe, no action in the US
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span
                  style={{
                    flexShrink: 0,
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "#2D7A3A",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontWeight: 800,
                  }}
                >
                  ✓
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1B2A4A" }}>
                    USA Gummies: dye-free since day one
                  </div>
                  <div style={{ fontSize: 11, color: "#1B2A4A", opacity: 0.6, marginTop: 2 }}>
                    Colors from fruit &amp; vegetable extracts only
                  </div>
                </div>
              </div>
            </div>

            <Link
              href="/no-artificial-dyes-gummy-bears"
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#1B2A4A",
                textDecoration: "underline",
                textUnderlineOffset: 4,
                marginTop: 4,
              }}
            >
              See our ingredients →
            </Link>
          </div>
        </div>
      </div>

      {/* Responsive grid override */}
      <style>{`
        @media (min-width: 640px) {
          [data-zone="DYE-FREE-NEWS"] .sm\\:!grid-cols-\\[1\\.3fr_0\\.7fr\\] {
            grid-template-columns: 1.3fr 0.7fr !important;
          }
        }
        @media (min-width: 640px) {
          [data-zone="DYE-FREE-NEWS"] .sm\\:!text-\\[28px\\] {
            font-size: 28px !important;
          }
        }
        @media (min-width: 1024px) {
          [data-zone="DYE-FREE-NEWS"] .lg\\:!text-\\[32px\\] {
            font-size: 32px !important;
          }
        }
      `}</style>
    </section>
  );
}
