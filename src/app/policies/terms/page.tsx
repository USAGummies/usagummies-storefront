import type { Metadata } from "next";
import Link from "next/link";
import ContactForm from "@/components/forms/ContactForm";

export const metadata: Metadata = {
  title: "Terms of Service | USA Gummies",
  description:
    "USA Gummies terms of service. Purchase terms, site use, and secure Shopify-powered checkout details.",
};

export default function TermsPage() {
  return (
    <main className="min-h-screen text-white">
      <div className="mx-auto max-w-4xl px-4 py-12">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link
            href="/policies"
            className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-sm text-white/80 hover:bg-white/5 hover:text-white"
          >
            ← Policies
          </Link>
          <Link
            href="/shop"
            className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-sm text-white/80 hover:bg-white/5 hover:text-white"
          >
            Shop →
          </Link>
        </div>

        <section className="glass p-7">
          <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
          <p className="mt-3 text-white/75">
            These terms apply to purchases made through USA Gummies. Checkout is processed securely
            through Shopify.
          </p>

          <div className="mt-8 space-y-6 text-white/80">
            <div className="glass-soft p-5">
              <h2 className="text-lg font-semibold text-white">Orders</h2>
              <p className="mt-2 text-sm text-white/75">
                By placing an order, you agree that the information you provide is accurate and that
                you are authorized to use the selected payment method.
              </p>
            </div>

            <div className="glass-soft p-5">
              <h2 className="text-lg font-semibold text-white">Pricing</h2>
              <p className="mt-2 text-sm text-white/75">
                Prices are shown in your cart at checkout. Bundle pricing and shipping eligibility
                (including free shipping on 5+ bags) are displayed clearly before you purchase.
              </p>
            </div>

            <div className="glass-soft p-5">
              <h2 className="text-lg font-semibold text-white">Checkout & payments</h2>
              <p className="mt-2 text-sm text-white/75">
                Checkout is powered by <strong className="text-white">Shopify</strong>.
                Payment details are processed securely by Shopify and related providers.
              </p>
            </div>

            <div className="glass-soft p-5">
              <h2 className="text-lg font-semibold text-white">Site use</h2>
              <p className="mt-2 text-sm text-white/75">
                You agree not to misuse the site, attempt unauthorized access, or disrupt site operations.
              </p>
            </div>

            <div className="glass-soft p-5">
              <h2 className="text-lg font-semibold text-white">Changes</h2>
              <p className="mt-2 text-sm text-white/75">
                We may update these terms from time to time. The latest version will always be posted on this page.
              </p>
            </div>
          </div>

          <div className="mt-10 border-t border-white/10 pt-8">
            <h2 className="text-xl font-semibold">Contact us</h2>
            <p className="mt-2 text-white/70">
              Terms question? Send a message and we’ll respond within one business day.
            </p>

            <div className="mt-5">
              <ContactForm context="Terms of Service Question" />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
