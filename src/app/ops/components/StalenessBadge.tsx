"use client";

import { freshnessFromTimestamp, type FreshnessStatus } from "@/lib/ops/freshness";

type StalenessItem = {
  label: string;
  timestamp: string | null | undefined;
};

type Props = {
  items: StalenessItem[];
};

const STATUS_PRIORITY: Record<FreshnessStatus, number> = {
  fresh: 0,
  stale: 1,
  missing: 2,
  critical: 3,
};

function statusColors(status: FreshnessStatus) {
  if (status === "critical") {
    return { text: "#c7362c", bg: "rgba(199,54,44,0.12)" };
  }
  if (status === "stale") {
    return { text: "#c7a062", bg: "rgba(199,160,98,0.16)" };
  }
  if (status === "missing") {
    return { text: "#6b7280", bg: "rgba(107,114,128,0.16)" };
  }
  return { text: "#166534", bg: "rgba(22,101,52,0.12)" };
}

function statusLabel(status: FreshnessStatus): string {
  if (status === "critical") return "Critical";
  if (status === "stale") return "Stale";
  if (status === "missing") return "Missing";
  return "Fresh";
}

export function StalenessBadge({ items }: Props) {
  const metas = items.map((item) => ({
    label: item.label,
    ...freshnessFromTimestamp(item.timestamp),
  }));

  if (metas.length === 0) return null;

  let worst = metas[0];
  for (const m of metas) {
    if (STATUS_PRIORITY[m.status] > STATUS_PRIORITY[worst.status]) {
      worst = m;
    }
  }

  const colors = statusColors(worst.status);
  const ageText =
    worst.ageMinutes == null ? "n/a" : `${worst.ageMinutes}m`;

  const tooltip = metas
    .map((m) => `${m.label}: ${statusLabel(m.status)} (${m.ageMinutes == null ? "n/a" : `${m.ageMinutes}m`})`)
    .join("\n");

  return (
    <span
      title={tooltip}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 11,
        fontWeight: 800,
        color: colors.text,
        background: colors.bg,
        letterSpacing: "0.03em",
        textTransform: "uppercase",
      }}
    >
      {statusLabel(worst.status)}
      <span style={{ fontWeight: 700, opacity: 0.9 }}>{ageText}</span>
    </span>
  );
}

