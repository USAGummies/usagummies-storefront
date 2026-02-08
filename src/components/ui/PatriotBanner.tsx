// src/components/ui/PatriotBanner.tsx
import Link from "next/link";
import Image from "next/image";
import { PatriotRibbon } from "@/components/ui/PatriotRibbon";
import { AmazonOneBagNote } from "@/components/ui/AmazonOneBagNote";
import { GummyIconRow, HeroPackIcon } from "@/components/ui/GummyIcon";

export function PatriotBanner({ showRibbon = true }: { showRibbon?: boolean }) {
  return (
    <section className="patriot-banner">
      <div className="patriot-banner__content" style={{ padding: 18 }}>
        <div className="kicker">USA Gummies • Made in the USA</div>

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
              Gummy bears made here.
              <br />
              Classic flavor.
              <br />
              No artificial dyes.
            </div>

            <div className="muted" style={{ marginTop: 10 }}>
              All natural flavors. Made in the USA. Free shipping at 5+ bags.
            </div>

            <div className="badge-row">
              <span className="badge">Made in the USA</span>
              <span className="badge">Ships fast</span>
              <span className="badge">No artificial dyes</span>
              <span className="badge">4.8 stars from verified Amazon buyers</span>
            </div>
          </div>

          <div className="candy-panel rounded-2xl relative overflow-hidden" style={{ padding: 14 }}>
            <Image
              src="/website%20assets/B17Bomber.png"
              alt="Vintage B-17 bomber illustration"
              aria-hidden="true"
              width={1200}
              height={800}
              sizes="(max-width: 980px) 1px, 220px"
              className="pointer-events-none absolute -right-16 -top-8 w-48 opacity-12"
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div className="kicker">Today’s pick</div>
              <HeroPackIcon size={28} className="icon-float" />
            </div>
            <div style={{ fontWeight: 950, fontSize: 18, marginTop: 8 }}>
              Lower the per-bag price with more bags
            </div>
            <div className="muted" style={{ marginTop: 8, fontSize: 14 }}>
              The cart highlights the most picked size. Add bags to unlock free shipping.
            </div>
            <div style={{ marginTop: 10 }}>
              <GummyIconRow size={14} className="opacity-80" />
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <Link className="btn btn-candy" href="/shop#bundle-pricing">
                Shop bags
              </Link>
            </div>
            <div style={{ marginTop: 8 }}>
              <AmazonOneBagNote className="text-[11px]" linkClassName="text-[var(--text)]" />
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
