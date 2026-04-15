import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OnboardingPortal } from "./OnboardingPortal";

export const metadata: Metadata = {
  title: "Complete Your Order | USA Gummies",
  description: "Finish setting up your USA Gummies wholesale order.",
  robots: { index: false, follow: false },
};

async function fetchDeal(dealId: string) {
  const site =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://www.usagummies.com");
  const res = await fetch(
    `${site}/api/ops/onboarding?dealId=${encodeURIComponent(dealId)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return null;
  return (await res.json()) as {
    ok: boolean;
    deal: {
      id: string;
      name: string;
      amount: string;
      stage: string;
      paymentMethod: string;
      onboardingComplete: boolean;
      paymentReceived: boolean;
    };
    contact: {
      id: string;
      email: string;
      firstname: string;
      lastname: string;
      company: string;
      phone: string;
      address: string;
      city: string;
      state: string;
      zip: string;
    } | null;
  };
}

export default async function OnboardingPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const data = await fetchDeal(dealId);
  if (!data?.ok || !data.deal) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[#f8f5f0] px-4 py-8">
      <div className="w-full max-w-xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-[#0a1e3d] tracking-tight">
            USA Gummies
          </h1>
          <p className="text-sm text-[#0a1e3d]/60 mt-1 tracking-widest uppercase">
            Order Onboarding
          </p>
        </div>

        <OnboardingPortal
          dealId={dealId}
          deal={data.deal}
          contact={data.contact}
        />

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-8">
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
