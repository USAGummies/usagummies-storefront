// Thin starfield strip. Verified-only copy — the three claims below are
// all printed on the bag or on the Shopify product panel. No fake batch
// numbers, no "bags shipped" counters, no "ships Friday" scarcity.
//
// Text color note: cream/off-white (not gold) so it reads cleanly against
// the navy + gold-star background. Gold-on-gold-stars made the headline
// disappear into the pattern on mobile (Ben's audit, 2026-04-25).
// The leading star ornament is gold for accent flair; the text itself is
// max-contrast cream.

export function ScarcityBar() {
  return (
    <section aria-label="Product claims" className="lp-starfield relative">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-center gap-4 px-5 py-3 text-center sm:gap-10 sm:px-8">
        <span className="lp-label flex items-center gap-2 text-[var(--lp-cream)]">
          <span aria-hidden className="lp-star-ornament h-3 w-3 text-[var(--lp-gold)]" />
          Sourced, Made &amp; Packed in the U.S.A.
        </span>
        <span className="lp-label hidden text-[var(--lp-cream)]/85 sm:inline-flex sm:items-center sm:gap-2">
          <span aria-hidden className="lp-star-ornament h-3 w-3 text-[var(--lp-red)]" />
          Five Natural Flavors · One 7.5 oz Bag
        </span>
      </div>
    </section>
  );
}
