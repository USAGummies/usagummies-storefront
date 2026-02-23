"use client";

import dynamic from "next/dynamic";

const AgenticCommandCenter = dynamic(() => import("@/components/ops/AgenticCommandCenter.client"), {
  ssr: false,
});

export default function CommandCenterShell() {
  return <AgenticCommandCenter />;
}
