import type { Metadata } from "next";

import { ShippingStatusView } from "./ShippingStatusView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Shipping Status",
};

export default function ShippingStatusPage() {
  return <ShippingStatusView />;
}
