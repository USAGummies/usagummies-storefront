import type { Metadata } from "next";
import { KpisView } from "./KpisView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "KPIs & Milestones" };

export default function KpisPage() {
  return <KpisView />;
}
