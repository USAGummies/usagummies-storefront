import type { Metadata } from "next";
import { PipelineView } from "./PipelineView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Pipeline",
};

export default function PipelinePage() {
  return <PipelineView />;
}
