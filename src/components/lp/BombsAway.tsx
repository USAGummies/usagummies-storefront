// Bomber scene — kept because the illustration itself is bag art.
// Stripped all fabricated specifics (no Spokane / Ashford / Mt. Rainier,
// no ship-time claims, no process bullets I couldn't verify). Copy is
// paraphrased from the bag's back panel.

import type { CSSProperties } from "react";
import Image from "next/image";

// Drop trajectory — each gummy starts already tilted (matches the
// angled-bear motif on the bag artwork) and tumbles further as it
// falls. Earlier rows hold a stronger lead-tilt; lower rows have
// already rotated through. Sizes shrink slightly with depth to fake
// perspective. Falls drift to one side (wind catch) so the cluster
// reads as a stream, not a column.
const DROPS = [
  { src: "/brand/gummies/gummy-red.png",    top: "20%", left: "40%", size: 60, rot: 32, drift:  10, spin:  44, delay: 0 },
  { src: "/brand/gummies/gummy-yellow.png", top: "28%", left: "52%", size: 52, rot: -38, drift: -8, spin: -52, delay: 220 },
  { src: "/brand/gummies/gummy-green.png",  top: "40%", left: "44%", size: 56, rot: 56,  drift: 14, spin:  60, delay: 440 },
  { src: "/brand/gummies/gummy-orange.png", top: "50%", left: "58%", size: 46, rot: -22, drift: -6, spin: -40, delay: 660 },
  { src: "/brand/gummies/gummy-pink.png",   top: "62%", left: "46%", size: 48, rot: 70,  drift: 12, spin:  48, delay: 880 },
  { src: "/brand/gummies/gummy-red.png",    top: "74%", left: "56%", size: 40, rot: -64, drift: -4, spin: -56, delay: 1100 },
  { src: "/brand/gummies/gummy-yellow.png", top: "84%", left: "48%", size: 36, rot: 84,  drift:  8, spin:  36, delay: 1320 },
];

export function BombsAway() {
  return (
    <section className="relative overflow-hidden border-y-2 border-[var(--lp-ink)]">
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
        {/* Copy column — generic American-made story only */}
        <div className="relative order-2 md:order-1">
          <p className="lp-label text-[var(--lp-red)]">★ Taste of Freedom ★</p>
          <h2 className="lp-display mt-3 text-[clamp(2.5rem,7vw,4.5rem)] text-[var(--lp-ink)] drop-shadow-[3px_3px_0_rgba(253,244,224,0.9)]">
            American
            <br />
            <span className="text-[var(--lp-red)]">by the bag.</span>
          </h2>
          <p className="lp-sans mt-6 max-w-[34ch] text-[1.05rem] leading-[1.65] text-[var(--lp-ink)]/88">
            Every bag you order is one more cheer for American jobs,
            American business, and the star-spangled pursuit of greatness.
            A proper gummy bear — built the American way.
          </p>
        </div>

        {/* Bomber illustration column */}
        <div className="relative order-1 min-h-[420px] md:order-2 md:min-h-[560px]">
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

          {DROPS.map((d, i) => (
            <div
              key={i}
              className="absolute"
              style={
                {
                  top: d.top,
                  left: d.left,
                  width: d.size,
                  height: d.size,
                  ["--lp-drop-rot" as string]: `${d.rot}deg`,
                  ["--lp-drop-drift" as string]: `${d.drift}px`,
                  ["--lp-drop-spin" as string]: `${d.spin}deg`,
                  transform: `rotate(${d.rot}deg)`,
                  animation: `lp-fall ${3.4 + (i % 3) * 0.6}s ease-in-out ${d.delay}ms infinite alternate`,
                } as CSSProperties
              }
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

      <style>{`
        @keyframes lp-bomber {
          0%   { transform: translateX(-4%) translateY(0); }
          50%  { transform: translateX(4%)  translateY(-6px); }
          100% { transform: translateX(-2%) translateY(2px); }
        }
        /* Tumbling fall — start pre-tilted, drift to one side, and
           continue rotating through the descent so each gummy reads as
           a falling object, not a static sticker. */
        @keyframes lp-fall {
          0%   { transform: translate(0, 0) rotate(var(--lp-drop-rot, 0deg)); }
          100% {
            transform:
              translate(var(--lp-drop-drift, 0px), 28px)
              rotate(calc(var(--lp-drop-rot, 0deg) + var(--lp-drop-spin, 18deg)));
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .lp-scope [style*="lp-bomber"],
          .lp-scope [style*="lp-fall"] { animation: none !important; }
        }
      `}</style>
    </section>
  );
}
