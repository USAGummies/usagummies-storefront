"use client";

import dynamic from "next/dynamic";

const AgenticCommandCenter = dynamic(() => import("@/components/ops/AgenticCommandCenter.client"), {
  ssr: false,
  loading: () => (
    <div style={{ color: "#12213f", padding: "40px 0", fontSize: 14, fontWeight: 600 }}>
      Loading agent dashboard...
    </div>
  ),
});

export function AgentsShell() {
  return <AgenticCommandCenter />;
}
