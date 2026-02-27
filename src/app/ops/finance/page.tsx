import type { Metadata } from "next";
import { FinanceView } from "./FinanceView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "P&L / Finance" };

export default function FinancePage() {
  return <FinanceView />;
}
