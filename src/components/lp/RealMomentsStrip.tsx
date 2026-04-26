// Real moments strip — four product-in-the-wild bag photos from the
// round-2 ad asset shoot. Each one features the actual USA Gummies bag
// in a different real-world scene: outdoors, kitchen, hands opening,
// gummies pouring. No copy claims, no captions that aren't on the bag —
// the photos carry the story. Headline is the bag's own back-panel
// phrasing ("Land of the Free, Home of the Brave").

import Image from "next/image";

const SHOTS = [
  {
    src: "/brand/ad-assets-round2/photo-pacific-northwest.png",
    alt: "USA Gummies bag with snow-capped mountain and Pacific Northwest forest",
    position: "center center",
  },
  {
    src: "/brand/ad-assets-round2/photo-generations-table.png",
    alt: "USA Gummies bag on a rustic wooden table with coffee and a bowl of gummy bears",
    position: "center center",
  },
  {
    src: "/brand/ad-assets-round2/photo-the-reveal.png",
    alt: "Hands tearing open a bag of USA Gummies on a rustic table",
    position: "center center",
  },
  {
    src: "/brand/ad-assets-round2/photo-pour-test.png",
    alt: "USA Gummies pouring out of the bag onto a marble surface",
    position: "center center",
  },
];

export function RealMomentsStrip() {
  return (
    <section className="relative bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
      <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
        <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="lp-label text-[var(--lp-red)]">★ Real Moments ★</p>
            <h2 className="lp-display mt-2 text-[clamp(2rem,5vw,3.25rem)] text-[var(--lp-ink)]">
              Land of the Free.
              <br />
              <span className="lp-script text-[var(--lp-red)]">
                Home of the Brave.
              </span>
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SHOTS.map((s, i) => (
            <figure
              key={s.src}
              className="relative overflow-hidden border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)]"
              style={{
                boxShadow:
                  i % 2 === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)",
              }}
            >
              <div className="relative aspect-square w-full">
                <Image
                  src={s.src}
                  alt={s.alt}
                  fill
                  sizes="(max-width: 640px) 88vw, (max-width: 1024px) 44vw, 280px"
                  className="object-cover"
                  style={{ objectPosition: s.position }}
                />
              </div>
              {/* Star count corner stamp on the first card only */}
              {i === 0 && (
                <div className="absolute right-2 top-2 rotate-[6deg]">
                  <div
                    className="lp-stamp"
                    style={{
                      width: "3.75rem",
                      height: "3.75rem",
                      fontSize: "0.5rem",
                      color: "var(--lp-red)",
                    }}
                  >
                    <span>
                      ★ ★ ★
                      <br />
                      MADE IN
                      <br />
                      THE U.S.A.
                      <br />
                      ★ ★ ★
                    </span>
                  </div>
                </div>
              )}
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
