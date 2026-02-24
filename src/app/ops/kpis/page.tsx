import type { Metadata } from "next";
import { KpisView } from "./KpisView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "KPIs",
};

export default function KpisPage() {
  return <KpisView />;
}
