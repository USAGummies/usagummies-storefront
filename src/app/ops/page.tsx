import type { Metadata } from "next";
import { OpsDashboard } from "./OpsDashboard.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Command Center",
};

export default function OpsHomePage() {
  return <OpsDashboard />;
}
