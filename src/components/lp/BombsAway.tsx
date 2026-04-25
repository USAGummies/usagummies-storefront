// Bomber scene — kept because the illustration itself is bag art.
// The standalone falling-gummies layer was pulled per Ben's audit
// ("the bomber still looks like shit, just remove the extra falling
// gummy bears"); the bomber illustration carries its own bombs-away
// motif inline, so the duplicate floating bears were noise.

import Image from "next/image";

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

        {/* Bomber illustration column — illustration only, no overlay
            falling bears (the asset includes its own gummy-drop motif). */}
        <div className="relative order-1 min-h-[360px] md:order-2 md:min-h-[480px]">
          <div
            className="absolute inset-0"
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
      </div>

      <style>{`
        @keyframes lp-bomber {
          0%   { transform: translateX(-4%) translateY(0); }
          50%  { transform: translateX(4%)  translateY(-6px); }
          100% { transform: translateX(-2%) translateY(2px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .lp-scope [style*="lp-bomber"] { animation: none !important; }
        }
      `}</style>
    </section>
  );
}
