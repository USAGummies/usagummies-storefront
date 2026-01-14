// src/components/ui/PatriotBanner.tsx
import Link from "next/link";
import { PatriotRibbon } from "@/components/ui/PatriotRibbon";

export function PatriotBanner({ showRibbon = true }: { showRibbon?: boolean }) {
  return (
    <section className="patriot-banner">
      <div className="patriot-banner__content" style={{ padding: 18 }}>
        <div className="kicker">USA Gummies • Built for America</div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 0.8fr",
            gap: 14,
            marginTop: 10,
            alignItems: "center",
          }}
          className="pb-grid"
        >
          <div>
            <div className="big-callout">
              Premium gummy bears.
              <br />
              Bold flavor.
              <br />
              Patriotic backbone.
            </div>

            <div className="muted" style={{ marginTop: 10 }}>
              All natural flavors. No artificial dyes. Fast shipping. Bundle
              pricing that pushes AOV without pushing cringe.
            </div>

            <div className="badge-row">
              <span className="badge">🇺🇸 Made in USA</span>
              <span className="badge">🚚 Ships fast</span>
              <span className="badge">✅ Dye-free</span>
              <span className="badge">⭐ 4.8 stars from verified Amazon buyers</span>
            </div>
          </div>

          <div className="metal-panel rounded-2xl border border-white/12" style={{ padding: 14 }}>
            <div className="kicker">Today’s move</div>
            <div style={{ fontWeight: 950, fontSize: 18, marginTop: 8 }}>
              Bundle & Save
            </div>
            <div className="muted" style={{ marginTop: 8, fontSize: 14 }}>
              The cart highlights the most popular bundle. Add more bags and
              unlock free shipping.
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <Link className="btn btn-red" href="/shop#bundle-pricing">
                Build a Bundle 🇺🇸
              </Link>
              <Link className="btn btn-navy" href="/shop">
                Shop All
              </Link>
            </div>
          </div>
        </div>

        {showRibbon ? (
          <div style={{ marginTop: 14 }}>
            <PatriotRibbon />
          </div>
        ) : null}
      </div>

      <style>{`
        @media (max-width: 980px){
          .pb-grid{ grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
