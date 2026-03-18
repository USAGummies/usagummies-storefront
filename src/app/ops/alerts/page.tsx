import type { Metadata } from "next";
import { AlertsView } from "./AlertsView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Alerts — USA Gummies Ops" };

export default function AlertsPage() {
  return <AlertsView />;
}
