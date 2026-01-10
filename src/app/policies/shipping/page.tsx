import type { Metadata } from "next";
import Link from "next/link";
import ContactForm from "@/components/forms/ContactForm";

export const metadata: Metadata = {
  title: "Shipping Policy | USA Gummies",
  description:
    "USA Gummies shipping policy including processing times, delivery expectations, tracking, and free shipping on 5+ bags.",
};

export default function ShippingPolicyPage() {
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
          <h1 className="text-3xl font-semibold tracking-tight">Shipping Policy</h1>
          <p className="mt-3 text-white/75">
            We keep shipping simple and predictable. Bundle pricing is clear on every product page,
            and free shipping on 5+ bags.
          </p>

          <div className="mt-8 space-y-6 text-white/80">
            <div className="glass-soft p-5">
              <h2 className="text-lg font-semibold text-white">Free shipping</h2>
              <p className="mt-2 text-sm text-white/75">
                Free shipping on orders of <strong className="text-white">5+ bags</strong>.
                The product page and cart will reflect this automatically.
              </p>
            </div>

            <div className="glass-soft p-5">
              <h2 className="text-lg font-semibold text-white">Processing time</h2>
              <p className="mt-2 text-sm text-white/75">
                Orders are typically processed within <strong className="text-white">1–2 business days</strong>.
                During high-volume periods, processing may take slightly longer.
              </p>
            </div>

            <div className="glass-soft p-5">
              <h2 className="text-lg font-semibold text-white">Delivery time</h2>
              <p className="mt-2 text-sm text-white/75">
                Delivery speed depends on the carrier and destination. Most customers receive orders
                within <strong className="text-white">2–7 business days</strong> after shipment.
              </p>
            </div>

            <div className="glass-soft p-5">
              <h2 className="text-lg font-semibold text-white">Tracking</h2>
              <p className="mt-2 text-sm text-white/75">
                Once your order ships, you’ll receive tracking details via email.
              </p>
            </div>

            <div className="glass-soft p-5">
              <h2 className="text-lg font-semibold text-white">Shipping issues</h2>
              <p className="mt-2 text-sm text-white/75">
                If your package is delayed, missing, or arrives damaged, contact us using the form below.
                We’ll make it right.
              </p>
            </div>
          </div>

          <div className="mt-10 border-t border-white/10 pt-8">
            <h2 className="text-xl font-semibold">Contact us</h2>
            <p className="mt-2 text-white/70">
              Shipping question? Send a message and we’ll respond within one business day.
            </p>

            <div className="mt-5">
              <ContactForm context="Shipping Policy Question" />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
