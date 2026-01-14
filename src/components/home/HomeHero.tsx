// src/components/home/HomeHero.tsx (FULL REPLACE)
import Link from "next/link";
import { PatriotBanner } from "@/components/ui/PatriotBanner";
import { PatriotRibbon } from "@/components/ui/PatriotRibbon";

export function HomeHero() {
  return (
    <section style={{ padding: "26px 0 10px" }}>
      <div className="container">
        <div className="card-solid" style={{ padding: 22, overflow: "hidden" }}>
          <div className="h-eyebrow">
            🇺🇸 American-made gummy bears • Fast shipping • Bundle-first pricing
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.25fr 0.75fr",
              gap: 18,
              alignItems: "center",
              marginTop: 12,
            }}
            className="hero-grid"
          >
            <div>
              <div className="h1">
                America tastes
                <br />
                better.
              </div>

              <p className="sub" style={{ marginTop: 12 }}>
                Premium gummies built in the USA — bold flavor, clean finish, and
                a cart that highlights the most popular bundle.
              </p>

              <div
                style={{
                  marginTop: 16,
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <Link className="btn btn-primary" href="/shop">
                  Shop Now 🇺🇸
                </Link>
                <Link className="btn btn-navy" href="/shop">
                  Build a Bundle
                </Link>
                <span className="chip">✅ Dye-free</span>
                <span className="chip">🚚 Ships fast</span>
                <span className="chip">⭐ 4.8 stars from verified Amazon buyers</span>
              </div>

              <div style={{ marginTop: 16 }}>
                <PatriotRibbon />
              </div>
            </div>

            <div className="hero-right">
              <div className="hero-flag" aria-hidden="true" />
              <div className="card" style={{ padding: 16, position: "relative" }}>
                <div className="h-eyebrow">Most popular pick</div>
                <div style={{ fontWeight: 950, fontSize: 22, marginTop: 8 }}>
                  Stack bags. Save more.
                </div>
                <div style={{ opacity: 0.8, lineHeight: 1.6, marginTop: 8 }}>
                  Bundle pricing + free shipping thresholds built in. Clean logic.
                  Higher AOV. No friction.
                </div>

                <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Link className="btn btn-primary" href="/shop">
                    Start Bundle
                  </Link>
                  <Link
                    className="btn"
                    href="/shop#product-details"
                  >
                    View Product
                  </Link>
                </div>
              </div>
            </div>
          </div>

          <div style={{ height: 16 }} />
          <PatriotBanner />

          <div style={{ marginTop: 16 }} className="rule" />
        </div>
      </div>

      <style>{`
        .hero-right{
          position: relative;
          min-height: 260px;
        }
        .hero-flag{
          position:absolute;
          inset: -30px -40px -30px -40px;
          z-index: 0;
          opacity: 0.12;
          background:
            radial-gradient(800px 400px at 20% 20%, rgba(18,59,122,0.6), transparent 55%),
            radial-gradient(700px 380px at 80% 10%, rgba(193,18,31,0.55), transparent 55%),
            repeating-linear-gradient(
              135deg,
              rgba(193,18,31,0.35) 0px,
              rgba(193,18,31,0.35) 14px,
              rgba(255,255,255,0.0) 14px,
              rgba(255,255,255,0.0) 28px
            );
          border-radius: 28px;
        }
        .hero-grid{ grid-template-columns: 1.25fr 0.75fr; }
        @media (max-width: 980px){
          .hero-grid{ grid-template-columns: 1fr !important; }
          .hero-right{ min-height: unset; }
          .hero-flag{ inset: -20px; }
        }
      `}</style>
    </section>
  );
}
