import type { Metadata } from "next";
import { PipelineView } from "./PipelineView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Territory & Pipeline" };

export default function PipelinePage() {
  return <PipelineView />;
}
