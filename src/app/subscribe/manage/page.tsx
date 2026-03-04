import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { ManageSubscription } from "./ManageSubscription.client";

export const metadata: Metadata = {
  title: "Manage Your Subscription | USA Gummies",
  description: "View, update, pause, or cancel your USA Gummies subscription.",
  robots: { index: false, follow: false },
};

export default function ManageSubscriptionPage() {
  return (
    <main className="relative overflow-hidden text-[var(--text)] min-h-screen home-candy">
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(circle at 12% 18%, rgba(45,122,58,0.12), transparent 48%), radial-gradient(circle at 85% 5%, rgba(199,166,98,0.14), transparent 38%)",
            opacity: 0.5,
          }}
        />
        <div className="relative mx-auto max-w-2xl px-4 py-10">
          <BreadcrumbJsonLd
            items={[
              { name: "Home", href: "/" },
              { name: "Subscribe & Save", href: "/subscribe" },
              { name: "Manage", href: "/subscribe/manage" },
            ]}
          />

          <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
            <div className="text-center">
              <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)]">
                Subscription
              </div>
              <h1 className="mt-3 text-3xl font-black leading-[1.1] tracking-tight text-[var(--text)]">
                Manage Your Subscription
              </h1>
              <p className="mt-3 text-sm text-[var(--muted)]">
                Update your quantity, frequency, or pause and cancel anytime.
              </p>
            </div>

            <div className="mt-6">
              <ManageSubscription />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
