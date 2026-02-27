import type { Metadata } from "next";
import { MarketingView } from "./MarketingView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Marketing & ROAS" };

export default function MarketingPage() {
  return <MarketingView />;
}
