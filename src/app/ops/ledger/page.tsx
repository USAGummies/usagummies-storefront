import type { Metadata } from "next";

import { LedgerView } from "./LedgerView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Rene's Ledger",
};

export default function LedgerPage() {
  return <LedgerView />;
}
