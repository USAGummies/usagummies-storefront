// The bomber section — a big, silly, signature visual that pulls straight
// from the bag art: a B-17 flying across a desert sky, dropping gummy bears
// like candy paratroopers. Turns the "Made in America" claim into a piece
// of theater instead of a bullet point.

import Image from "next/image";

const DROPS = [
  { src: "/brand/gummies/gummy-red.png",    top: "18%", left: "38%", size: 56, rot: 12 },
  { src: "/brand/gummies/gummy-yellow.png", top: "26%", left: "48%", size: 48, rot: -18 },
  { src: "/brand/gummies/gummy-green.png",  top: "40%", left: "40%", size: 52, rot: 26 },
  { src: "/brand/gummies/gummy-orange.png", top: "50%", left: "54%", size: 44, rot: -8 },
  { src: "/brand/gummies/gummy-pink.png",   top: "62%", left: "42%", size: 46, rot: 14 },
  { src: "/brand/gummies/gummy-red.png",    top: "72%", left: "52%", size: 38, rot: -22 },
  { src: "/brand/gummies/gummy-yellow.png", top: "82%", left: "46%", size: 36, rot: 6 },
];

export function BombsAway() {
  return (
    <section className="relative overflow-hidden border-y-2 border-[var(--lp-ink)]">
      {/* Desert background */}
      <div aria-hidden className="absolute inset-0 -z-10">
        <Image
          src="/brand/illustrations/background-desert.png"
          alt=""
          fill
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--lp-cream)]/30 via-transparent to-[var(--lp-cream)]/30" />
      </div>

      <div className="relative mx-auto grid max-w-[1200px] grid-cols-1 gap-6 px-5 py-16 sm:px-8 sm:py-24 md:grid-cols-[1fr_1.1fr] md:gap-12">
        {/* Copy column */}
        <div className="relative order-2 md:order-1">
          <p className="lp-label text-[var(--lp-red)]">★ Small-Batch · Mighty Mission ★</p>
          <h2 className="lp-display mt-3 text-[clamp(2.5rem,7vw,4.5rem)] text-[var(--lp-ink)] drop-shadow-[3px_3px_0_rgba(253,244,224,0.9)]">
            Dropped
            <br />
            <span className="text-[var(--lp-red)]">From&nbsp;the&nbsp;Sky.</span>
          </h2>
          <p className="lp-script mt-2 text-[clamp(1.5rem,4vw,2rem)] text-[var(--lp-navy)]">
            (Well, a warehouse in Washington.)
          </p>

          <p className="lp-sans mt-6 max-w-[34ch] text-[1.05rem] leading-[1.65] text-[var(--lp-ink)]/88">
            Every bag of USA Gummies is pressed in Spokane, packed by hand in
            Ashford, and shipped from the foot of Mt. Rainier. No overseas
            factory. No mystery ingredients. Just a small American batch of
            the gummy bears we grew up with — rebuilt the right way.
          </p>

          <ul className="lp-sans mt-6 space-y-2 text-[1rem] font-medium">
            {[
              "Spokane, WA — pressed in an FDA-registered confectionery",
              "Ashford, WA — packaged, stamped, and shipped by hand",
              "Nationwide — standard ground, 3-5 days, free on 5+",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2 text-[var(--lp-ink)]">
                <span
                  aria-hidden
                  className="lp-star-ornament mt-[0.35em] h-3 w-3 flex-none text-[var(--lp-red)]"
                />
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* Bomber column */}
        <div className="relative order-1 min-h-[420px] md:order-2 md:min-h-[560px]">
          {/* Bomber itself */}
          <div className="absolute left-0 right-0 top-0 h-[45%]">
            <div
              className="relative h-full w-full"
              style={{ animation: "lp-bomber 16s ease-in-out infinite alternate" }}
            >
              <Image
                src="/brand/illustrations/b17-bomber.png"
                alt="B-17 bomber dropping gummy bears"
                fill
                sizes="(max-width: 768px) 95vw, 600px"
                className="object-contain drop-shadow-[4px_6px_0_rgba(14,22,56,0.6)]"
              />
            </div>
          </div>

          {/* Falling gummy trail */}
          {DROPS.map((d, i) => (
            <div
              key={i}
              className="absolute"
              style={{
                top: d.top,
                left: d.left,
                width: d.size,
                height: d.size,
                transform: `rotate(${d.rot}deg)`,
                animation: `lp-fall ${3 + (i % 3)}s ease-in-out ${i * 200}ms infinite alternate`,
              }}
            >
              <Image
                src={d.src}
                alt=""
                width={d.size}
                height={d.size}
                className="drop-shadow-[2px_3px_0_rgba(14,22,56,0.6)]"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Keyframes scoped to this section */}
      <style>{`
        @keyframes lp-bomber {
          0%   { transform: translateX(-4%) translateY(0); }
          50%  { transform: translateX(4%)  translateY(-6px); }
          100% { transform: translateX(-2%) translateY(2px); }
        }
        @keyframes lp-fall {
          0%   { transform: translateY(0) rotate(0deg); }
          100% { transform: translateY(22px) rotate(14deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .lp-scope [style*="lp-bomber"],
          .lp-scope [style*="lp-fall"] { animation: none !important; }
        }
      `}</style>
    </section>
  );
}
