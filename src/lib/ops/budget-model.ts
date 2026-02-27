import { createElement, type ReactElement } from "react";

export type BudgetTriple = {
  actual: number;
  plan: number;
  budget?: number | null;
};

export type BudgetStatus = "on-track" | "under-spend" | "over-spend" | "no-budget";

export type BudgetLine = {
  category: string;
  allocated: number | null;
  spent: number;
  remaining: number | null;
  utilizationPct: number | null;
  pacing: BudgetPacing;
};

export type BudgetPacing = {
  elapsedPct: number;
  spendPct: number | null;
  projectedSpend: number | null;
  variancePct: number | null;
  status: BudgetStatus;
};

export type BudgetGaugeProps = {
  allocated: number | null | undefined;
  spent: number;
  label?: string;
  height?: number;
  backgroundColor?: string;
  fillColor?: string;
  overfillColor?: string;
  textColor?: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dayStart(input: Date): number {
  const d = new Date(input);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function calcUtilization(
  allocated: number | null | undefined,
  spent: number,
): number | null {
  if (allocated == null || allocated <= 0) return null;
  return (spent / allocated) * 100;
}

export function calcPacing(params: {
  allocated: number | null | undefined;
  spent: number;
  periodStart: string | Date;
  periodEnd: string | Date;
  now?: Date;
}): BudgetPacing {
  const { allocated, spent } = params;
  if (allocated == null || allocated <= 0) {
    return {
      elapsedPct: 0,
      spendPct: null,
      projectedSpend: null,
      variancePct: null,
      status: "no-budget",
    };
  }

  const now = params.now ?? new Date();
  const startMs = dayStart(new Date(params.periodStart));
  const endMs = dayStart(new Date(params.periodEnd));
  const nowMs = dayStart(now);
  const spanDays = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);
  const elapsedDays = clamp(
    Math.round((nowMs - startMs) / 86400000) + 1,
    1,
    spanDays,
  );

  const elapsedPct = (elapsedDays / spanDays) * 100;
  const spendPct = (spent / allocated) * 100;
  const projectedSpend = elapsedDays > 0 ? (spent / elapsedDays) * spanDays : spent;
  const variancePct = elapsedPct > 0 ? spendPct - elapsedPct : null;

  let status: BudgetStatus = "on-track";
  if (spendPct < elapsedPct * 0.7) status = "under-spend";
  if (spendPct > elapsedPct * 1.2 || spendPct > 100) status = "over-spend";

  return {
    elapsedPct: Math.round(elapsedPct * 10) / 10,
    spendPct: Math.round(spendPct * 10) / 10,
    projectedSpend: Math.round(projectedSpend * 100) / 100,
    variancePct: variancePct == null ? null : Math.round(variancePct * 10) / 10,
    status,
  };
}

export function buildBudgetLine(params: {
  category: string;
  allocated: number | null | undefined;
  spent: number;
  periodStart: string | Date;
  periodEnd: string | Date;
  now?: Date;
}): BudgetLine {
  const allocated = params.allocated ?? null;
  const spent = Math.round(params.spent * 100) / 100;
  const utilization = calcUtilization(allocated, spent);

  return {
    category: params.category,
    allocated,
    spent,
    remaining:
      allocated == null ? null : Math.round((allocated - spent) * 100) / 100,
    utilizationPct: utilization == null ? null : Math.round(utilization * 10) / 10,
    pacing: calcPacing({
      allocated,
      spent,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      now: params.now,
    }),
  };
}

export function BudgetGauge({
  allocated,
  spent,
  label,
  height = 8,
  backgroundColor = "#e5e7eb",
  fillColor = "#1B2A4A",
  overfillColor = "#c7362c",
  textColor = "#1f2937",
}: BudgetGaugeProps): ReactElement | null {
  const utilization = calcUtilization(allocated, spent);
  if (utilization == null) return null;

  const widthPct = clamp(utilization, 0, 100);
  const displayPct = Math.round(utilization * 10) / 10;
  const barColor = utilization > 100 ? overfillColor : fillColor;

  return createElement(
    "div",
    { style: { width: "100%", display: "grid", gap: 4 } },
    label
      ? createElement(
          "div",
          {
            style: {
              fontSize: 12,
              color: textColor,
              display: "flex",
              justifyContent: "space-between",
            },
          },
          createElement("span", null, label),
          createElement("span", null, `${displayPct}%`),
        )
      : null,
    createElement(
      "div",
      {
        style: {
          width: "100%",
          height,
          borderRadius: 999,
          background: backgroundColor,
          overflow: "hidden",
        },
      },
      createElement("div", {
        style: {
          width: `${widthPct}%`,
          height: "100%",
          borderRadius: 999,
          background: barColor,
          transition: "width 0.2s ease",
        },
      }),
    ),
  );
}
