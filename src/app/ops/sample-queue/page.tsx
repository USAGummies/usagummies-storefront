import type { Metadata } from "next";

import { SampleQueueView } from "./SampleQueueView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Sample Queue",
};

export default function SampleQueuePage() {
  return <SampleQueueView />;
}
