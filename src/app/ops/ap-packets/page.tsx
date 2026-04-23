import type { Metadata } from "next";

import { ApPacketsView } from "./ApPacketsView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Retailer AP Packets",
};

export default function ApPacketsPage() {
  return <ApPacketsView />;
}
