import type { Metadata } from "next";
import { ReconciliationView } from "./ReconciliationView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Revenue Reconciliation" };

export default function ReconciliationPage() {
  return <ReconciliationView />;
}
