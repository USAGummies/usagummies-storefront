"use client";

import { RefreshCw } from "lucide-react";
import { NAVY } from "@/app/ops/tokens";

type Props = {
  onClick: () => void;
  loading: boolean;
  label?: string;
};

export function RefreshButton({ onClick, loading, label = "Refresh" }: Props) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        border: "none",
        borderRadius: 8,
        background: NAVY,
        color: "#fff",
        padding: "10px 14px",
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        cursor: loading ? "wait" : "pointer",
        opacity: loading ? 0.82 : 1,
        fontFamily: "inherit",
      }}
    >
      <RefreshCw size={15} style={{ animation: loading ? "norad-spin 0.9s linear infinite" : "none" }} />
      {loading ? "Refreshing..." : label}
      <style>{`@keyframes norad-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </button>
  );
}
