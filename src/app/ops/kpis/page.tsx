import type { Metadata } from "next";
import { KpisView } from "./KpisView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "KPI Scoreboard" };

export default function KpisPage() {
  return <KpisView />;
}
