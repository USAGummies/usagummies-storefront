// Rationed-batch ticker — styled like a wartime poster announcement.

export function ScarcityBar() {
  return (
    <section aria-label="Inventory update" className="lp-starfield relative">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-center gap-4 px-5 py-3 text-center sm:gap-10 sm:px-8">
        <span className="lp-label flex items-center gap-2 text-[var(--lp-gold)]">
          <span aria-hidden className="lp-star-ornament h-3 w-3" />
          Small-Batch · Next Wave Ships Friday
        </span>
        <span className="lp-label hidden text-[var(--lp-off-white)]/75 sm:inline-flex sm:items-center sm:gap-2">
          <span aria-hidden className="lp-star-ornament h-3 w-3 text-[var(--lp-red)]" />
          4,200 Bags Pressed · 1,872 Shipped
        </span>
      </div>
    </section>
  );
}
