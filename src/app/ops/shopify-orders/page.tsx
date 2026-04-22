import type { Metadata } from "next";

import { ShopifyOrdersView } from "./ShopifyOrdersView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Shopify DTC Queue",
};

export default function ShopifyOrdersPage() {
  return <ShopifyOrdersView />;
}
