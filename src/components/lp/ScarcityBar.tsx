// Honest scarcity — this is just inventory reality, not a fake countdown.
// A single-line ticker in bold caps.

export function ScarcityBar() {
  return (
    <section
      aria-label="Inventory update"
      className="bg-[var(--lp-ink)] text-[var(--lp-cream)]"
    >
      <div className="mx-auto flex max-w-[1200px] items-center justify-center gap-8 px-5 py-3 sm:px-8">
        <span className="lp-mono text-[0.7rem] sm:text-[0.75rem]">
          <span aria-hidden className="mr-2 text-[var(--lp-blood)]">●</span>
          Small-batch. Next wave ships Friday.
        </span>
        <span className="hidden sm:inline lp-mono text-[0.7rem] text-[var(--lp-cream)]/65">
          4,200 bags pressed · 1,872 shipped
        </span>
      </div>
    </section>
  );
}
