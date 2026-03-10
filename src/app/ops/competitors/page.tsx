import type { Metadata } from "next";
import { CompetitorsView } from "./CompetitorsView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Competitive Intel" };

export default function CompetitorsPage() {
  return <CompetitorsView />;
}
