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
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto max-w-4xl px-4 py-12">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link
            href="/"
            className="rounded-full border border-[var(--border)] bg-white px-3 py-1 text-sm text-[var(--text)] hover:bg-[var(--surface-strong)]"
          >
            ← Home
          </Link>
          <Link
            href="/shop"
            className="rounded-full border border-[var(--border)] bg-white px-3 py-1 text-sm text-[var(--text)] hover:bg-[var(--surface-strong)]"
          >
            Shop →
          </Link>
        </div>

        <section className="candy-panel p-7">
          <h1 className="text-3xl font-semibold tracking-tight">Contact</h1>
          <p className="mt-3 text-[var(--muted)]">
            Customer support or business inquiries — send a message below.
            We respond within one business day.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              {
                title: "Fast response",
                copy: "We reply within one business day on weekdays.",
              },
              {
                title: "Order help",
                copy: "Include your order number for faster support.",
              },
              {
                title: "Shipping & returns",
                copy: "See our policies for timing and return details.",
                link: "/policies",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="card-solid rounded-2xl border border-[var(--border)] p-4 text-sm text-[var(--muted)]"
              >
                <div className="text-sm font-semibold text-[var(--text)]">{item.title}</div>
                <div className="mt-2">
                  {item.copy}{" "}
                  {item.link ? (
                    <Link href={item.link} className="underline underline-offset-4">
                      View policies
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 card-solid p-5 text-sm text-[var(--muted)]">
            <div className="font-semibold text-[var(--text)]">What can we help with?</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--muted)]">
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
