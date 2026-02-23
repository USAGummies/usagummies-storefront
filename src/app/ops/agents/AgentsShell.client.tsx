"use client";

import dynamic from "next/dynamic";

const AgenticCommandCenter = dynamic(() => import("@/components/ops/AgenticCommandCenter.client"), {
  ssr: false,
  loading: () => (
    <div style={{ color: "rgba(255,255,255,0.4)", padding: "40px 0", fontSize: 14 }}>
      Loading agent dashboard...
    </div>
  ),
});

export function AgentsShell() {
  return <AgenticCommandCenter />;
}
