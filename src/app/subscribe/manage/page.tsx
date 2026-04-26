import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { PageHero } from "@/components/lp/PageHero";
import { ManageSubscription } from "./ManageSubscription.client";

export const metadata: Metadata = {
  title: "Manage Your Subscription | USA Gummies",
  description: "View, update, pause, or cancel your USA Gummies subscription.",
  robots: { index: false, follow: false },
};

export default function ManageSubscriptionPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Subscribe & Save", href: "/subscribe" },
          { name: "Manage", href: "/subscribe/manage" },
        ]}
      />

      <PageHero
        eyebrow="Subscription"
        headline="Manage your"
        scriptAccent="subscription."
        sub="Update your quantity, frequency, or pause and cancel anytime."
      />

      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[640px] px-5 py-14 sm:px-8 sm:py-20">
          <div
            className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-8"
            style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
          >
            <ManageSubscription />
          </div>
        </div>
      </section>
    </main>
  );
}
