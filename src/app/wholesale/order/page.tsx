/**
 * /wholesale/order — Phase 35.f.4 page scaffold.
 *
 * Hosts the multi-step onboarding flow. Public-facing — anyone with
 * the URL can start. The state machine + KV persistence are the
 * authorization boundary; out-of-order POSTs throw at the route.
 *
 * URL `?flowId=X` resumes a previously-started flow. Lead capture
 * remains at `/wholesale` for top-of-funnel; this page is the
 * committed-intent path (per `/contracts/wholesale-onboarding-
 * flow.md` v1.0 Q1 default).
 */
import type { Metadata } from "next";
import { Suspense } from "react";

import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { PageHero } from "@/components/lp/PageHero";

import { OnboardingFlow } from "./OnboardingFlow";

export const metadata: Metadata = {
  title: "Place a wholesale order | USA Gummies",
  description:
    "Multi-step wholesale order flow — pricing, payment, AP onboarding, and shipping. For retailers, distributors, and bulk buyers ordering 36+ bags.",
  robots: { index: false }, // committed-intent flow; not for SEO crawl
};

export default function WholesaleOrderPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Wholesale", href: "/wholesale" },
          { name: "Order", href: "/wholesale/order" },
        ]}
      />

      <PageHero
        eyebrow="Wholesale order flow"
        headline="Place an order"
        scriptAccent="step by step."
        sub="Pricing, AP onboarding, and shipping in one flow. Save and resume anytime — your link includes a flow ID."
      />

      <section className="bg-[var(--lp-cream)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[760px] px-5 py-10 sm:px-8 sm:py-14">
          <Suspense
            fallback={
              <p className="lp-sans text-sm text-[var(--lp-ink)]/60">
                Loading flow…
              </p>
            }
          >
            <OnboardingFlow />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
