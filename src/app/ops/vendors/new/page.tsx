import type { Metadata } from "next";

import { VendorOnboardingView } from "./VendorOnboardingView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Vendor Onboarding",
};

export default function VendorOnboardingPage() {
  return <VendorOnboardingView />;
}
