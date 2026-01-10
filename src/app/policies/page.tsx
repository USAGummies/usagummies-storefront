import type { Metadata } from "next";
import Link from "next/link";
import ContactForm from "@/components/forms/ContactForm";

export const metadata: Metadata = {
  title: "Policies | USA Gummies",
  description:
    "USA Gummies policies including shipping, returns, privacy, and terms of service. Transparent, customer-first, and easy to understand.",
};

const POLICIES = [
  {
    href: "/policies/shipping",
    title: "Shipping Policy",
    desc: "Processing times, delivery expectations, and tracking. Free shipping on 5+ bags.",
  },
  {
    href: "/policies/returns",
    title: "Returns & Refunds",
    desc: "Food-safety rules, damaged/incorrect orders, and refund timing.",
  },
  {
    href: "/policies/privacy",
    title: "Privacy Policy",
    desc: "What we collect, how it’s used, and how Shopify checkout protects payments.",
  },
  {
    href: "/policies/terms",
    title: "Terms of Service",
    desc: "General terms for using the site and purchasing through Shopify checkout.",
  },
];

export default function PoliciesIndexPage() {
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
          <h1 className="text-3xl font-semibold tracking-tight">Policies</h1>
          <p className="mt-3 text-white/75">
            Clear, customer-first policies — built to keep checkout simple and expectations
            transparent.
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            {POLICIES.map((p) => (
              <Link
                key={p.href}
                href={p.href}
                className="group rounded-3xl border border-white/10 bg-white/5 p-5 transition hover:border-white/15 hover:bg-white/10"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-white">
                      {p.title}
                    </div>
                    <div className="mt-2 text-sm text-white/70">{p.desc}</div>
                  </div>
                  <div className="shrink-0 text-sm text-[#DBAA79] opacity-80 group-hover:opacity-100">
                    View →
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <div className="mt-10 border-t border-white/10 pt-8">
            <h2 className="text-xl font-semibold">Need help?</h2>
            <p className="mt-2 text-white/70">
              Send a message below. We respond within one business day.
            </p>

            <div className="mt-5">
              <ContactForm context="Policies Index Question" />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
