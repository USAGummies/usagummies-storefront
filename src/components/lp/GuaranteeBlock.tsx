// Guarantee + second CTA — the closer. Big red stamp, one sentence, one button.

import Link from "next/link";

export function GuaranteeBlock() {
  return (
    <section className="relative bg-[var(--lp-ink)] text-[var(--lp-cream)]">
      {/* faint halftone texture layer */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "radial-gradient(var(--lp-cream) 1px, transparent 1px)",
          backgroundSize: "6px 6px",
        }}
      />
      <div className="relative mx-auto flex max-w-[1200px] flex-col items-center gap-8 px-5 py-16 text-center sm:px-8 sm:py-24">
        {/* big stamp */}
        <div
          className="lp-stamp"
          style={{
            borderColor: "var(--lp-cream)",
            color: "var(--lp-cream)",
            boxShadow:
              "inset 0 0 0 2px var(--lp-ink), inset 0 0 0 3px var(--lp-cream)",
            fontSize: "0.8rem",
            padding: "0.6rem 1rem",
          }}
        >
          <span>30-Day Money-Back Guarantee</span>
        </div>

        <h2 className="lp-display text-[clamp(2.2rem,6vw,4.5rem)] leading-[0.95]">
          Eat the bag.
          <br />
          <span className="lp-editorial italic text-[var(--lp-blood)]">
            If you don&rsquo;t love it,
          </span>
          <br />
          we&rsquo;ll refund it.
        </h2>

        <p className="lp-editorial max-w-[48ch] text-[1.2rem] text-[var(--lp-cream)]/85">
          No questionnaires. No photo of the half-eaten bag. Reply to your
          order email and we wire the money back. That&rsquo;s the deal.
        </p>

        <Link
          href="/go/checkout?qty=1&utm_source=lp&utm_medium=guarantee"
          className="lp-cta"
          style={{
            background: "var(--lp-cream)",
            color: "var(--lp-ink)",
            borderColor: "var(--lp-cream)",
            boxShadow: "5px 5px 0 var(--lp-blood)",
          }}
        >
          Order a bag — $5.99
        </Link>

        <p className="lp-mono text-[var(--lp-cream)]/65">
          Free shipping on 5+ · Ships from Washington state
        </p>
      </div>
    </section>
  );
}
