import type {
  CommittedVendorMargin,
  MarginAlert,
  MarginRange,
  PerVendorMarginLedger,
} from "@/lib/finance/per-vendor-margin";

export interface VendorMarginSummary {
  totalCommitted: number;
  totalPending: number;
  totalChannels: number;
  belowFloor: number;
  thin: number;
  unknown: number;
  healthy: number;
  needsActual: number;
}

const ALERT_RANK: Record<MarginAlert, number> = {
  below_floor: 0,
  thin: 1,
  unknown: 2,
  healthy: 3,
};

export function summarizeVendorMarginLedger(
  ledger: PerVendorMarginLedger | null | undefined,
): VendorMarginSummary {
  const vendors = Array.isArray(ledger?.committedVendors)
    ? ledger.committedVendors
    : [];
  return {
    totalCommitted: vendors.length,
    totalPending: Array.isArray(ledger?.pendingVendors)
      ? ledger.pendingVendors.length
      : 0,
    totalChannels: Array.isArray(ledger?.channelRows)
      ? ledger.channelRows.length
      : 0,
    belowFloor: vendors.filter((v) => v.marginAlert === "below_floor").length,
    thin: vendors.filter((v) => v.marginAlert === "thin").length,
    unknown: vendors.filter((v) => v.marginAlert === "unknown").length,
    healthy: vendors.filter((v) => v.marginAlert === "healthy").length,
    needsActual: vendors.filter((v) =>
      Object.values(v.fields ?? {}).some((field) => field.needsActual),
    ).length,
  };
}

export function sortCommittedVendorsForReview(
  vendors: ReadonlyArray<CommittedVendorMargin> | null | undefined,
): CommittedVendorMargin[] {
  return [...(vendors ?? [])].sort((a, b) => {
    const alertDiff = ALERT_RANK[a.marginAlert] - ALERT_RANK[b.marginAlert];
    if (alertDiff !== 0) return alertDiff;
    const aGp = a.gpPerBagUsd?.min ?? Number.POSITIVE_INFINITY;
    const bGp = b.gpPerBagUsd?.min ?? Number.POSITIVE_INFINITY;
    if (aGp !== bGp) return aGp - bGp;
    return a.name.localeCompare(b.name);
  });
}

export function formatUsdRange(range: MarginRange | null | undefined): string {
  if (!range) return "TBD";
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) return "TBD";
  if (Math.abs(range.max - range.min) < 0.005) {
    return `$${range.min.toFixed(2)}`;
  }
  return `$${range.min.toFixed(2)}-$${range.max.toFixed(2)}`;
}

export function formatPercentRange(
  range: MarginRange | null | undefined,
): string {
  if (!range) return "TBD";
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) return "TBD";
  if (Math.abs(range.max - range.min) < 0.05) {
    return `${Math.round(range.min)}%`;
  }
  return `${Math.round(range.min)}%-${Math.round(range.max)}%`;
}

export function formatUsdValue(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "TBD";
  return `$${value.toFixed(2)}`;
}

export function labelForAlert(alert: MarginAlert): string {
  switch (alert) {
    case "below_floor":
      return "Below floor";
    case "thin":
      return "Thin";
    case "unknown":
      return "Needs actuals";
    case "healthy":
      return "Healthy";
  }
}

export function toneForAlert(
  alert: MarginAlert,
): "red" | "amber" | "blue" | "green" {
  switch (alert) {
    case "below_floor":
      return "red";
    case "thin":
      return "amber";
    case "unknown":
      return "blue";
    case "healthy":
      return "green";
  }
}
