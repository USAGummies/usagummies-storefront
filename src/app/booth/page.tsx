import type { Metadata } from "next";
import { BoothOrderForm } from "./BoothOrderForm";

export const metadata: Metadata = {
  title: "Quick Wholesale Order | USA Gummies",
  description: "Place a wholesale order for USA Gummies bags, cases, and master cartons.",
  robots: { index: false, follow: false },
};

export default function BoothOrderPage() {
  return (
    <main className="min-h-screen bg-[#f8f5f0] px-4 py-8">
      <div className="w-full max-w-lg mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-[#0a1e3d] tracking-tight">
            USA Gummies
          </h1>
          <p className="text-sm text-[#0a1e3d]/60 mt-1 tracking-widest uppercase">
            Wholesale Order
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-[#0a1e3d] mb-1">
            Quick Wholesale Order
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            Order bags, cases, or master cartons for shipping or in-person handoff.
          </p>

          <BoothOrderForm />
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-6">
          FDA-Registered · cGMP · Made in America
          <br />
          Questions? Email{" "}
          <a
            href="mailto:ben@usagummies.com"
            className="text-[#b22234] hover:underline"
          >
            ben@usagummies.com
          </a>{" "}
          or call (307) 209-4928
        </p>
      </div>
    </main>
  );
}
