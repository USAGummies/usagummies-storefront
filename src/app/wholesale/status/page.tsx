import type { Metadata } from "next";
import { OrderStatusLookup } from "./OrderStatusLookup";

export const metadata: Metadata = {
  title: "Order Status | USA Gummies Wholesale",
  description: "Check the status of your USA Gummies wholesale order.",
  robots: { index: false, follow: false },
};

export default function WholesaleStatusPage() {
  return (
    <main className="min-h-screen bg-[#f8f5f0] px-4 py-8">
      <div className="w-full max-w-xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-[#0a1e3d] tracking-tight">
            USA Gummies
          </h1>
          <p className="text-sm text-[#0a1e3d]/60 mt-1 tracking-widest uppercase">
            Order Status
          </p>
        </div>

        <OrderStatusLookup />

        <p className="text-center text-xs text-gray-400 mt-6">
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
