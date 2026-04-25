// Sustainability block — domestic-supply-chain story.
// Every claim here is verifiable from Ben's supply chain: the candy,
// the colors, the flavor, and the film of the bag are all sourced and
// produced inside the United States. Inventory moves between domestic
// facilities only. No vendor names, no recycled-material claims, no
// compostable claims, no specific carbon numbers.
//
// Canonical copy lives at docs/sustainability-snippet.md so the same
// story can echo across the home page, footer, PDP, and a future
// /sustainability page.

import Image from "next/image";

const POINTS = [
  {
    label: "American Supply Chain",
    body: "Candy, flavor, colors, even the bag film — every input made stateside.",
  },
  {
    label: "Domestic-Only Freight",
    body: "Inventory moves between U.S. facilities. No ocean shipping, no air cargo.",
  },
  {
    label: "Fewer Miles per Bag",
    body: "A shorter route from raw material to your hand than imported gummies.",
  },
];

export function SustainabilityBlock() {
  return (
    <section className="relative border-y-2 border-[var(--lp-ink)] bg-[var(--lp-cream)]">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-10 px-5 py-16 sm:px-8 sm:py-24 md:grid-cols-[1fr_1.2fr] md:gap-16">
        {/* Eagle ornament column */}
        <div className="relative order-2 flex items-center justify-center md:order-1">
          <div className="relative aspect-square w-full max-w-[420px]">
            <div
              aria-hidden
              className="absolute inset-[8%] rounded-full"
              style={{
                background:
                  "radial-gradient(closest-side, var(--lp-gold-light) 0%, var(--lp-gold) 45%, transparent 72%)",
                opacity: 0.45,
              }}
            />
            <Image
              src="/brand/illustrations/eagle.png"
              alt=""
              fill
              sizes="(max-width: 768px) 80vw, 420px"
              className="relative object-contain drop-shadow-[4px_5px_0_rgba(14,22,56,0.4)]"
            />
          </div>
        </div>

        {/* Story column */}
        <div className="order-1 md:order-2">
          <p className="lp-label text-[var(--lp-red)]">★ A Smaller Footprint ★</p>
          <h2 className="lp-display mt-3 text-[clamp(2.2rem,6vw,4rem)] leading-[0.95] text-[var(--lp-ink)]">
            Made Here.
            <br />
            <span className="lp-script text-[var(--lp-red)]">
              Shipped Less.
            </span>
          </h2>
          <p className="lp-sans mt-6 max-w-[42ch] text-[1.1rem] leading-[1.65] text-[var(--lp-ink)]/88">
            USA Gummies runs on a 100% American supply chain. The candy,
            the flavor, the colors, even the plastic film of the bag —
            all sourced and produced here in the United States. No
            overseas freight. No transcontinental cargo. Just a shorter
            route, fewer miles per bag, and a lighter footprint than
            gummies whose ingredients crossed an ocean to get here.
          </p>

          <ul className="mt-8 space-y-3">
            {POINTS.map((p) => (
              <li
                key={p.label}
                className="flex items-start gap-3 border-l-[3px] border-[var(--lp-red)] bg-[var(--lp-off-white)] py-3 pl-4 pr-4 sm:pl-5"
                style={{ boxShadow: "3px 3px 0 var(--lp-ink)" }}
              >
                <span
                  aria-hidden
                  className="lp-star-ornament mt-[0.4em] h-3 w-3 flex-none text-[var(--lp-red)]"
                />
                <div>
                  <span className="lp-display block text-[1.05rem] text-[var(--lp-ink)]">
                    {p.label}
                  </span>
                  <span className="lp-sans block text-[0.95rem] font-normal leading-[1.5] text-[var(--lp-ink)]/82">
                    {p.body}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
