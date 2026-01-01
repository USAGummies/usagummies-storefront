import type { Metadata } from "next";
import Link from "next/link";
import ContactForm from "@/components/forms/ContactForm";

export const metadata: Metadata = {
  title: "Contact USA Gummies | Customer Support & Inquiries",
  description:
    "Contact USA Gummies for customer support or business inquiries. We respond within one business day.",
};

export default function ContactPage() {
  return (
    <main className="min-h-screen text-white">
      <div className="mx-auto max-w-4xl px-4 py-12">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link
            href="/"
            className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-sm text-white/80 hover:bg-white/5 hover:text-white"
          >
            ← Home
          </Link>
          <Link
            href="/shop"
            className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-sm text-white/80 hover:bg-white/5 hover:text-white"
          >
            Shop →
          </Link>
        </div>

        <section className="glass p-7">
          <h1 className="text-3xl font-semibold tracking-tight">Contact</h1>
          <p className="mt-3 text-white/75">
            Customer support or business inquiries — send a message below.
            We respond within one business day.
          </p>

          <div className="mt-6 glass-soft p-5 text-sm text-white/75">
            <div className="font-semibold text-white">What can we help with?</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-white/75">
              <li>Order questions</li>
              <li>Shipping & delivery</li>
              <li>Damaged or incorrect items</li>
              <li>Wholesale / partnerships</li>
            </ul>
          </div>

          <div className="mt-6">
            <ContactForm context="Contact Page" />
          </div>
        </section>
      </div>
    </main>
  );
}
