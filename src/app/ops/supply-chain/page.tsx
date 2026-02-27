import type { Metadata } from "next";
import { SupplyChainView } from "./SupplyChainView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Supply Chain" };

export default function SupplyChainPage() {
  return <SupplyChainView />;
}
