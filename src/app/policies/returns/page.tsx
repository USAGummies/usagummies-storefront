import type { Metadata } from "next";
import Link from "next/link";
import ContactForm from "@/components/forms/ContactForm";

export const metadata: Metadata = {
  title: "Returns & Refunds | USA Gummies",
  description:
    "USA Gummies returns and refunds policy. Food-safety rules, damaged or incorrect orders, and refund timing.",
};

export default function ReturnsPolicyPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto max-w-4xl px-4 py-12">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link
            href="/policies"
            className="rounded-full border border-[var(--border)] bg-white px-3 py-1 text-sm text-[var(--text)] hover:bg-[var(--surface-strong)]"
          >
            ← Policies
          </Link>
          <Link
            href="/shop"
            className="rounded-full border border-[var(--border)] bg-white px-3 py-1 text-sm text-[var(--text)] hover:bg-[var(--surface-strong)]"
          >
            Shop →
          </Link>
        </div>

        <section className="candy-panel p-7">
          <h1 className="text-3xl font-semibold tracking-tight">Returns & Refunds</h1>
          <p className="mt-3 text-[var(--muted)]">
            This returns and refund policy is customer-first while following food-safety best
            practices. If something arrives wrong or damaged, we will make it right.
          </p>

          <div className="mt-8 space-y-6 text-[var(--muted)]">
            <div className="card-solid p-5">
              <h2 className="text-lg font-semibold text-[var(--text)]">30-day money-back guarantee</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                We offer a 30-day money-back guarantee from delivery. If you are not satisfied,
                contact us and we’ll make it right with a refund or replacement, subject to
                food-safety guidelines.
              </p>
            </div>

            <div className="card-solid p-5">
              <h2 className="text-lg font-semibold text-[var(--text)]">Food item policy</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Because our products are food items, we generally cannot accept returns of opened items.
                If your order arrives damaged or incorrect, contact us and we’ll resolve it quickly.
              </p>
            </div>

            <div className="card-solid p-5">
              <h2 className="text-lg font-semibold text-[var(--text)]">Damaged or incorrect orders</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                If your order arrives damaged or incorrect, contact us within{" "}
                <strong className="text-[var(--text)]">7 days</strong> of delivery. Include your order number and,
                if possible, a photo of the issue.
              </p>
            </div>

            <div className="card-solid p-5">
              <h2 className="text-lg font-semibold text-[var(--text)]">Refund timing</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                If a refund is approved, it will be issued to the original payment method.
                Processing times vary by bank and card issuer.
              </p>
            </div>

            <div className="card-solid p-5">
              <h2 className="text-lg font-semibold text-[var(--text)]">Order changes</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                If you need to update an address or correct an order detail, contact us as soon as possible.
                Once an order ships, changes may not be possible.
              </p>
            </div>
          </div>

          <div className="mt-10 border-t border-[var(--border)] pt-8">
            <h2 className="text-xl font-semibold">Contact us</h2>
            <p className="mt-2 text-[var(--muted)]">
              Returns or refund question? Send a message and we’ll respond within one business day.
            </p>

            <div className="mt-5">
              <ContactForm context="Returns & Refunds Question" />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
