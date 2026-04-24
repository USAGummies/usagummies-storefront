// Guarantee + closing CTA — navy star-field panel with a giant red stamp,
// flanked by the Statue of Liberty and an Eagle illustration (bag art).

import Image from "next/image";
import Link from "next/link";

export function GuaranteeBlock() {
  return (
    <section className="lp-starfield relative overflow-hidden">
      {/* Liberty (left) + Eagle (right) at large screens — ornamental */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 hidden w-[22%] md:block"
      >
        <div className="relative h-full w-full">
          <Image
            src="/brand/illustrations/statue-liberty.png"
            alt=""
            fill
            sizes="320px"
            className="object-contain object-bottom opacity-90 drop-shadow-[3px_4px_0_rgba(0,0,0,0.4)]"
          />
        </div>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-[22%] md:block"
      >
        <div className="relative h-full w-full">
          <Image
            src="/brand/illustrations/eagle.png"
            alt=""
            fill
            sizes="320px"
            className="object-contain object-[right_center] opacity-90 drop-shadow-[3px_4px_0_rgba(0,0,0,0.4)]"
          />
        </div>
      </div>

      <div className="relative mx-auto flex max-w-[1200px] flex-col items-center gap-8 px-5 py-16 text-center sm:px-8 sm:py-24">
        <div
          className="lp-stamp"
          style={{
            width: "10rem",
            height: "10rem",
            fontSize: "0.85rem",
            color: "var(--lp-red)",
            background: "var(--lp-off-white)",
            boxShadow: "inset 0 0 0 3px var(--lp-off-white), inset 0 0 0 5px var(--lp-red), 6px 6px 0 var(--lp-ink)",
          }}
        >
          <span>
            ★ ★ ★
            <br />
            30-Day
            <br />
            Money-Back
            <br />
            Guarantee
            <br />
            ★ ★ ★
          </span>
        </div>

        <h2 className="lp-display text-[clamp(2.2rem,6vw,4.25rem)] leading-[0.95] text-[var(--lp-off-white)]">
          Eat the bag.
          <br />
          <span className="lp-script text-[var(--lp-gold)]">
            If you don&rsquo;t love it,
          </span>
          <br />
          we&rsquo;ll refund it.
        </h2>

        <p className="lp-sans max-w-[48ch] text-[1.15rem] font-normal text-[var(--lp-off-white)]/90">
          No questionnaires. No photo of the half-eaten bag. Reply to your
          order email and we wire the money back. That&rsquo;s the deal.
        </p>

        <Link
          href="/go/checkout?qty=1&utm_source=lp&utm_medium=guarantee"
          className="lp-cta lp-cta-light"
        >
          Order a Bag · $5.99
        </Link>

        <p className="lp-label text-[var(--lp-off-white)]/70">
          Free Shipping on 5+ · Ships From Washington State
        </p>
      </div>
    </section>
  );
}
