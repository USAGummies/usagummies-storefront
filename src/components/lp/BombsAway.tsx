// Bomber scene — kept because the illustration itself is bag art.
// Stripped all fabricated specifics (no Spokane / Ashford / Mt. Rainier,
// no ship-time claims, no process bullets I couldn't verify). Copy is
// paraphrased from the bag's back panel.

import type { CSSProperties } from "react";
import Image from "next/image";

// Drop trajectory — sized so each bear silhouette READS as a bear
// at the page's normal viewing zoom (the previous 36-60px sizes
// rendered as colored rectangles, per Ben's audit). Spread laterally
// instead of stacking under the bomb bay so silhouettes don't overlap
// into a confetti pile. Each bear starts pre-tilted (matches the
// angled-bear motif on the bag artwork) and continues spinning as it
// falls — the cluster reads as a stream of bears, not floating
// stickers.
const DROPS = [
  { src: "/brand/gummies/gummy-red.png",    top: "22%", left: "42%", size: 100, rot:  28, drift:  14, spin:  42, delay: 0 },
  { src: "/brand/gummies/gummy-yellow.png", top: "32%", left: "60%", size:  88, rot: -34, drift: -10, spin: -48, delay: 240 },
  { src: "/brand/gummies/gummy-green.png",  top: "44%", left: "38%", size:  94, rot:  52, drift:  18, spin:  56, delay: 480 },
  { src: "/brand/gummies/gummy-orange.png", top: "54%", left: "66%", size:  80, rot: -20, drift:  -8, spin: -36, delay: 720 },
  { src: "/brand/gummies/gummy-pink.png",   top: "66%", left: "44%", size:  84, rot:  68, drift:  16, spin:  44, delay: 960 },
  { src: "/brand/gummies/gummy-red.png",    top: "78%", left: "62%", size:  72, rot: -60, drift:  -6, spin: -52, delay: 1200 },
  { src: "/brand/gummies/gummy-yellow.png", top: "88%", left: "50%", size:  64, rot:  82, drift:  10, spin:  32, delay: 1440 },
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
