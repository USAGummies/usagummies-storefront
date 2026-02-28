import type { Metadata } from "next";
import { KpisView } from "../kpis/KpisView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Alerts & Actions" };

export default function AlertsPage() {
  return <KpisView />;
}
