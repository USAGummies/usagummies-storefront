import type { Metadata } from "next";

import { TodayView } from "./TodayView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Today",
};

export default function TodayPage() {
  return <TodayView />;
}
