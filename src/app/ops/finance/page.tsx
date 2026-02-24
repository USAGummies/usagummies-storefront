import type { Metadata } from "next";
import { FinanceView } from "./FinanceView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Finance",
};

export default function FinancePage() {
  return <FinanceView />;
}
