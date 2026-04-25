// Guarantee + closing CTA. Copy is now only what's already published
// elsewhere on the site (returns policy + BagSlider): "30-day
// money-back guarantee" and "ships within 24 hours." No location claims.

import Image from "next/image";
import Link from "next/link";

export function GuaranteeBlock() {
  return (
    <section className="lp-starfield relative overflow-hidden">
      {/* Liberty stays bottom-left as a single ornament — the eagle was
          pulled (per Ben's audit) so the central guarantee stamp + CTA
          can carry the panel without competing imagery. */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 hidden w-[14%] max-w-[180px] md:block"
        style={{ height: "70%" }}
      >
        <div className="relative h-full w-full">
          <Image
            src="/brand/illustrations/statue-liberty.png"
            alt=""
            fill
            sizes="180px"
            className="object-contain object-bottom opacity-85 drop-shadow-[3px_4px_0_rgba(0,0,0,0.45)]"
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
            boxShadow:
              "inset 0 0 0 3px var(--lp-off-white), inset 0 0 0 5px var(--lp-red), 6px 6px 0 var(--lp-ink)",
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
          Taste a bag.
          <br />
          <span className="lp-script text-[var(--lp-gold)]">
            If it&rsquo;s not for you,
          </span>
          <br />
          we&rsquo;ll refund it.
        </h2>

        <p className="lp-sans max-w-[48ch] text-[1.15rem] font-normal text-[var(--lp-off-white)]/90">
          30-day satisfaction guarantee on every order. Ships within 24 hours.
        </p>

        <Link
          href="/go/checkout?qty=1&utm_source=lp&utm_medium=guarantee"
          className="lp-cta lp-cta-light"
        >
          Order a Bag · $5.99
        </Link>

        <p className="lp-label text-[var(--lp-off-white)]/70">
          Free Shipping on 5+ Bags
        </p>
      </div>
    </section>
  );
}
