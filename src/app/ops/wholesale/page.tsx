import type { Metadata } from "next";
import { WholesaleView } from "./WholesaleView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Wholesale",
};

export default function WholesalePage() {
  return <WholesaleView />;
}
