import type { Metadata } from "next";

import { PipelineDriftView } from "./PipelineDriftView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Pipeline Drift",
};

export default function PipelineDriftPage() {
  return <PipelineDriftView />;
}
