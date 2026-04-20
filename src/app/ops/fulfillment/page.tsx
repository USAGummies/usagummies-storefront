import type { Metadata } from "next";

import { FulfillmentView } from "./FulfillmentView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Fulfillment Queue",
};

export default function FulfillmentPage() {
  return <FulfillmentView />;
}
