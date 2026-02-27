import type { Metadata } from "next";
import { FinanceView } from "./FinanceView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Financial Operations" };

export default function FinancePage() {
  return <FinanceView />;
}
