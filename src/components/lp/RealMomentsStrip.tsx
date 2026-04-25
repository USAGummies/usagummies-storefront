// Real moments strip — three actual lifestyle photos. Ben's audit:
// "we need to use real images. like the gummies in my hand". Swapped
// the brand billboards out for the real product-in-the-wild
// photography staged in /public/brand/photos/.
//
// No copy claims, no captions that aren't on the bag — the photos
// carry the story. Headline is the bag's own back-panel phrasing
// ("Land of the Free, Home of the Brave").

import Image from "next/image";

// `objectPosition` aims the 5/4 crop at the most product-forward
// part of each photo so the gummies + bag actually show in the card,
// not just the background.
const SHOTS = [
  {
    src: "/brand/photos/hand-gummies.jpg",
    alt: "A handful of USA Gummies dye-free gummy bears",
    position: "center 65%",
  },
  {
    src: "/brand/photos/book-pages-gummies.jpg",
    alt: "USA Gummies bag with an open book and gummy bears",
    position: "center center",
  },
  {
    src: "/brand/photos/diner-scene.png",
    alt: "USA Gummies in an American diner setting",
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

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {SHOTS.map((s, i) => (
            <figure
              key={s.src}
              className="relative overflow-hidden border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)]"
              style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
            >
              <div className="relative aspect-[5/4] w-full">
                <Image
                  src={s.src}
                  alt={s.alt}
                  fill
                  sizes="(max-width: 640px) 88vw, (max-width: 1200px) 30vw, 360px"
                  className="object-cover"
                  style={{ objectPosition: s.position }}
                />
                {/* Subtle navy multiply for cohesion with the palette */}
                <div
                  aria-hidden
                  className="absolute inset-0 bg-[var(--lp-navy)] opacity-[0.04] mix-blend-multiply"
                />
              </div>
              {/* Star count corner stamp on the first card only */}
              {i === 0 && (
                <div className="absolute right-2 top-2 rotate-[6deg]">
                  <div
                    className="lp-stamp"
                    style={{
                      width: "4.25rem",
                      height: "4.25rem",
                      fontSize: "0.55rem",
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
