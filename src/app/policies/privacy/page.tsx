import type { Metadata } from "next";
import Link from "next/link";
import ContactForm from "@/components/forms/ContactForm";

export const metadata: Metadata = {
  title: "Privacy Policy | USA Gummies",
  description:
    "USA Gummies privacy policy. What information we collect, how it’s used, and how Shopify checkout protects payment details.",
};

export default function PrivacyPolicyPage() {
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
          <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
          <p className="mt-3 text-white/75">
            We keep privacy simple: we only use information needed to process your order
            and improve your experience. Payments are handled securely through Shopify checkout.
          </p>

          <div className="mt-8 space-y-6 text-white/80">
            <div className="glass-soft p-5">
              <h2 className="text-lg font-semibold text-white">What we collect</h2>
              <p className="mt-2 text-sm text-white/75">
                When you place an order, we collect information required to fulfill it, such as
                your name, shipping address, email, and order details.
              </p>
            </div>

            <div className="glass-soft p-5">
              <h2 className="text-lg font-semibold text-white">How we use it</h2>
              <p className="mt-2 text-sm text-white/75">
                We use your information to process orders, provide updates, respond to support requests,
                and improve the site experience.
              </p>
            </div>

            <div className="glass-soft p-5">
              <h2 className="text-lg font-semibold text-white">Payments</h2>
              <p className="mt-2 text-sm text-white/75">
                Payment information is processed securely through{" "}
                <strong className="text-white">Shopify checkout</strong>.
                We do not store your full payment card details on our servers.
              </p>
            </div>

            <div className="glass-soft p-5">
              <h2 className="text-lg font-semibold text-white">Cookies</h2>
              <p className="mt-2 text-sm text-white/75">
                We may use cookies and similar technologies to support site functionality
                and understand how visitors use the site.
              </p>
            </div>

            <div className="glass-soft p-5">
              <h2 className="text-lg font-semibold text-white">Contact</h2>
              <p className="mt-2 text-sm text-white/75">
                If you have privacy questions, contact us using the form below.
              </p>
            </div>
          </div>

          <div className="mt-10 border-t border-white/10 pt-8">
            <h2 className="text-xl font-semibold">Contact us</h2>
            <p className="mt-2 text-white/70">
              Privacy question? Send a message and we’ll respond within one business day.
            </p>

            <div className="mt-5">
              <ContactForm context="Privacy Policy Question" />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
