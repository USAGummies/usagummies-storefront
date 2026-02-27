import type { Metadata } from "next";
import { PipelineView } from "./PipelineView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pipeline & Deals" };

export default function PipelinePage() {
  return <PipelineView />;
}
