import type { Metadata } from "next";
import { PageHero } from "@/components/lp/PageHero";
import { OrderStatusLookup } from "./OrderStatusLookup";

export const metadata: Metadata = {
  title: "Order Status | USA Gummies Wholesale",
  description: "Check the status of your USA Gummies wholesale order.",
  robots: { index: false, follow: false },
};

export default function WholesaleStatusPage() {
  return (
    <main>
      <PageHero
        eyebrow="Wholesale"
        headline="Order"
        scriptAccent="status."
        sub="Look up the latest on your USA Gummies wholesale order."
      />

      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[640px] px-5 py-14 sm:px-8 sm:py-20">
          <div
            className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-8"
            style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
          >
            <OrderStatusLookup />
          </div>

          <p className="lp-sans mt-6 text-center text-[0.9rem] text-[var(--lp-ink)]/70">
            Questions? Email{" "}
            <a
              href="mailto:ben@usagummies.com"
              className="text-[var(--lp-red)] underline underline-offset-4"
            >
              ben@usagummies.com
            </a>{" "}
            or call (307) 209-4928
          </p>
        </div>
      </section>
    </main>
  );
}
