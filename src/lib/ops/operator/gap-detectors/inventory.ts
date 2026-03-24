import { analyzeInventory, type InventoryForecast } from "@/lib/ops/abra-inventory-forecast";
import { notify } from "@/lib/ops/notify";
import { readState, writeState } from "@/lib/ops/state";
import type { OperatorTaskInsert } from "@/lib/ops/operator/gap-detectors/qbo";

type InventoryAlertSummary = {
  healthy: number;
  info: number;
  warning: number;
  critical: number;
};

type InventoryAlertResult = {
  tasks: OperatorTaskInsert[];
  summary: InventoryAlertSummary;
  watch: Array<{
    sku: string;
    product_name: string;
    current_stock: number;
    daily_sell_rate: number;
    days_until_stockout: number;
    threshold: "healthy" | "info" | "warning" | "critical";
  }>;
};

const INVENTORY_STATE_KEY = "abra-operator-inventory-thresholds" as never;

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function thresholdForDays(days: number): "healthy" | "info" | "warning" | "critical" {
  if (!Number.isFinite(days) || days > 45) return "healthy";
  if (days > 30) return "info";
  if (days >= 14) return "warning";
  return "critical";
}

function thresholdIcon(threshold: "healthy" | "info" | "warning" | "critical"): string {
  switch (threshold) {
    case "healthy":
      return "✅";
    case "info":
      return "⚠️";
    case "warning":
      return "🟡";
    default:
      return "🔴";
  }
}

function buildNaturalKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
}

export async function detectInventoryAlerts(): Promise<InventoryAlertResult> {
  const forecasts = await analyzeInventory().catch(() => [] as InventoryForecast[]);
  const totalRows = forecasts.filter((row) => row.channel === "total");
  const previous = await readState<Record<string, string>>(INVENTORY_STATE_KEY, {});

  const summary: InventoryAlertSummary = {
    healthy: 0,
    info: 0,
    warning: 0,
    critical: 0,
  };
  const watch: InventoryAlertResult["watch"] = [];
  const tasks: OperatorTaskInsert[] = [];
  const nextState: Record<string, string> = {};

  for (const row of totalRows) {
    const threshold = thresholdForDays(row.days_until_stockout);
    summary[threshold] += 1;
    watch.push({
      sku: row.sku,
      product_name: row.product_name,
      current_stock: row.current_stock,
      daily_sell_rate: row.daily_sell_rate,
      days_until_stockout: row.days_until_stockout,
      threshold,
    });
    nextState[row.sku] = threshold;

    if ((previous[row.sku] && previous[row.sku] !== threshold) || (!previous[row.sku] && threshold !== "healthy")) {
      await notify({
        channel: "alerts",
        text:
          `${thresholdIcon(threshold)} Inventory threshold changed for ${row.product_name}${row.sku ? ` (${row.sku})` : ""}: ` +
          `${previous[row.sku] || "unknown"} → ${threshold}. ${row.current_stock} units on hand, ` +
          `${Number.isFinite(row.days_until_stockout) ? `${round2(row.days_until_stockout)} days` : "unknown runway"} remaining.`,
      }).catch(() => {});
    }

    if (threshold === "critical") {
      tasks.push({
        task_type: "inventory_reorder_po",
        title: `Draft reorder PO for ${row.product_name}`,
        description:
          `${row.product_name}${row.sku ? ` (${row.sku})` : ""} is below 14 days of supply. ` +
          `${row.current_stock} units remain at ${round2(row.daily_sell_rate)} units/day.`,
        priority: "critical",
        source: "gap_detector:inventory",
        assigned_to: "abra",
        requires_approval: true,
        execution_params: {
          natural_key: buildNaturalKey(["inventory_reorder_po", row.sku, threshold]),
          sku: row.sku,
          product_name: row.product_name,
          current_stock: row.current_stock,
          daily_sell_rate: round2(row.daily_sell_rate),
          days_until_stockout: round2(row.days_until_stockout),
          suggested_reorder_qty: Math.max(0, Math.ceil(row.suggested_reorder_qty)),
          vendor_email: "gregk@powers-inc.com",
        },
        tags: ["inventory", "po", "approval"],
      });
    }
  }

  await writeState(INVENTORY_STATE_KEY, nextState);

  return { tasks, summary, watch };
}
