import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BoothOrderForm } from "./BoothOrderForm";
import { BOOTH_ACCESS_KEY } from "@/lib/booth/access";

export const metadata: Metadata = {
  title: "Wholesale Order | USA Gummies",
  description: "Start a wholesale order with USA Gummies — premium dye-free gummy candy.",
  robots: { index: false, follow: false },
};

export default async function BoothOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ k?: string }>;
}) {
  const { k } = await searchParams;
  if (k !== BOOTH_ACCESS_KEY) {
    // Direct visits without the QR's access key go to the public lead-capture
    // page so prospects still convert; only QR scanners reach the order form.
    redirect("/wholesale");
  }

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
            Start Your Order
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            Premium dye-free gummy bears — candy that&apos;s better for you.
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
