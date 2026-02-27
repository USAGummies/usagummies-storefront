"use client";

import { SURFACE_BORDER } from "@/app/ops/tokens";

const shimmer = {
  background: "linear-gradient(90deg, rgba(27,42,74,0.06) 20%, rgba(27,42,74,0.14) 50%, rgba(27,42,74,0.06) 80%)",
  backgroundSize: "200% 100%",
  animation: "norad-shimmer 1.4s linear infinite",
};

type SkeletonChartProps = {
  height?: number;
};

export function SkeletonChart({ height = 220 }: SkeletonChartProps) {
  return (
    <div
      style={{
        border: `1px solid ${SURFACE_BORDER}`,
        borderRadius: 10,
        height,
        ...shimmer,
      }}
    >
      <style>{`@keyframes norad-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
    </div>
  );
}

type SkeletonTableProps = {
  rows?: number;
};

export function SkeletonTable({ rows = 5 }: SkeletonTableProps) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <style>{`@keyframes norad-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
      {Array.from({ length: rows }).map((_, idx) => (
        <div
          key={idx}
          style={{
            height: 26,
            borderRadius: 8,
            border: `1px solid ${SURFACE_BORDER}`,
            ...shimmer,
          }}
        />
      ))}
    </div>
  );
}
