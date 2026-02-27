import type { Metadata } from "next";
import { ForecastView } from "./ForecastView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cash Forecast" };

export default function ForecastPage() {
  return <ForecastView />;
}
