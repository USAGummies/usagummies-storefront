import type { HubSpotProactiveItem } from "./hubspot-proactive";

export type BuyingTemperature = "hot" | "warm" | "cold";

export type ClosingLane =
  | "replied_no_next_step"
  | "sample_requested"
  | "sample_shipped"
  | "sample_delivered"
  | "pricing_requested"
  | "vendor_setup"
  | "po_likely"
  | "order_shipped"
  | "reorder_due"
  | "call_task";

export interface ClosingMachineRow {
  id: string;
  label: string;
  href: string;
  temperature: BuyingTemperature;
  lane: ClosingLane;
  blocker: string;
  nextMove: string;
  defaultCloseAsk: string;
}

export interface ClosingMachineReport {
  mantra: string;
  counts: {
    hot: number;
    warm: number;
    cold: number;
    total: number;
  };
  lanes: Array<{
    lane: ClosingLane;
    label: string;
    dailyAction: string;
    count: number;
    topRows: ClosingMachineRow[];
  }>;
}

const DEFAULT_CLOSE_ASK =
  "Want me to set up a simple 1-case starter order so you can test it at the register?";

const LANE_COPY: Record<ClosingLane, { label: string; dailyAction: string }> = {
  replied_no_next_step: {
    label: "Replied, no next step",
    dailyAction: "Reply with one clear next ask.",
  },
  sample_requested: {
    label: "Sample requested",
    dailyAction: "Ship sample within 24 hours.",
  },
  sample_shipped: {
    label: "Sample shipped",
    dailyAction: "Follow up on day 3, 7, 14.",
  },
  sample_delivered: {
    label: "Sample delivered",
    dailyAction: "Ask for trial order / register-strip test.",
  },
  pricing_requested: {
    label: "Pricing requested",
    dailyAction: "Send quote plus one close option.",
  },
  vendor_setup: {
    label: "Vendor setup",
    dailyAction: "Push paperwork until completed.",
  },
  po_likely: {
    label: "PO likely",
    dailyAction: "Ask directly for first order.",
  },
  order_shipped: {
    label: "Order shipped",
    dailyAction: "Schedule reorder check-in.",
  },
  reorder_due: {
    label: "Reorder due",
    dailyAction: "Ask for reorder.",
  },
  call_task: {
    label: "Call task",
    dailyAction: "Call or close the task after review.",
  },
};

const LANE_ORDER: ClosingLane[] = [
  "po_likely",
  "pricing_requested",
  "vendor_setup",
  "sample_delivered",
  "sample_shipped",
  "sample_requested",
  "reorder_due",
  "order_shipped",
  "replied_no_next_step",
  "call_task",
];

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

export function classifyClosingRow(item: HubSpotProactiveItem): ClosingMachineRow {
  const text = `${item.label} ${item.detail} ${item.nextAction}`.toLowerCase();
  let lane: ClosingLane = "replied_no_next_step";
  let temperature: BuyingTemperature = "warm";
  let blocker = "No explicit buying signal captured yet.";
  let nextMove = "Find the next concrete buyer action and ask for it.";

  if (item.kind === "open_call_task") {
    lane = "call_task";
    temperature = item.severity === "critical" || item.severity === "watch" ? "warm" : "cold";
    blocker = "Open call task is still unresolved.";
    nextMove = "Call or dismiss the task after review.";
  }
  if (includesAny(text, ["sample requested", "asked for sample", "sample request"])) {
    lane = "sample_requested";
    temperature = "hot";
    blocker = "Sample has not been confirmed shipped.";
    nextMove = "Ship sample within 24 hours and stamp follow-up dates.";
  }
  if (includesAny(text, ["sample shipped", "sample sent"])) {
    lane = "sample_shipped";
    temperature = "hot";
    blocker = "Sample is out, but the buyer has not made a decision.";
    nextMove = "Ask for reaction, then make the 1-case starter-order ask.";
  }
  if (includesAny(text, ["sample delivered", "delivered"])) {
    lane = "sample_delivered";
    temperature = "hot";
    blocker = "Product arrived; no trial order decision captured.";
    nextMove = "Ask if register-strip or counter candy placement is the right test.";
  }
  if (includesAny(text, ["pricing", "quote", "economics"])) {
    lane = "pricing_requested";
    temperature = "hot";
    blocker = "Buyer needs economics before deciding.";
    nextMove = "Send quote with one simple close option.";
  }
  if (includesAny(text, ["vendor setup", "w-9", "coi", "paperwork", "ap packet"])) {
    lane = "vendor_setup";
    temperature = "hot";
    blocker = "Admin paperwork is blocking the order.";
    nextMove = "Push the setup packet until completed.";
  }
  if (includesAny(text, ["po likely", "po received", "purchase order", "first order"])) {
    lane = "po_likely";
    temperature = "hot";
    blocker = "Buyer intent exists; first paid order is not captured.";
    nextMove = "Ask directly for the first order.";
  }
  if (includesAny(text, ["order shipped", "first order shipped"])) {
    lane = "order_shipped";
    temperature = "hot";
    blocker = "Reorder clock has not been scheduled.";
    nextMove = "Set reorder due date before the day ends.";
  }
  if (includesAny(text, ["reorder", "buy again"])) {
    lane = "reorder_due";
    temperature = "hot";
    blocker = "Account is due for repeat order.";
    nextMove = "Ask for the reorder now.";
  }

  return {
    id: item.id,
    label: item.label,
    href: item.href,
    temperature,
    lane,
    blocker,
    nextMove,
    defaultCloseAsk: DEFAULT_CLOSE_ASK,
  };
}

export function buildClosingMachineReport(
  items: HubSpotProactiveItem[],
  options: { topRowsPerLane?: number } = {},
): ClosingMachineReport {
  const topRowsPerLane = Math.max(1, Math.min(5, options.topRowsPerLane ?? 3));
  const rows = items.map(classifyClosingRow);
  const counts = {
    hot: rows.filter((r) => r.temperature === "hot").length,
    warm: rows.filter((r) => r.temperature === "warm").length,
    cold: rows.filter((r) => r.temperature === "cold").length,
    total: rows.length,
  };
  const lanes = LANE_ORDER.map((lane) => {
    const laneRows = rows.filter((r) => r.lane === lane);
    return {
      lane,
      label: LANE_COPY[lane].label,
      dailyAction: LANE_COPY[lane].dailyAction,
      count: laneRows.length,
      topRows: laneRows.slice(0, topRowsPerLane),
    };
  }).filter((lane) => lane.count > 0);
  return {
    mantra:
      "Every sample needs a decision. Every response needs a next step. Every shipment needs a reorder date. Every day needs cash movement.",
    counts,
    lanes,
  };
}

export function renderClosingMachineBriefLine(report: ClosingMachineReport): string {
  if (report.counts.total === 0) return "May closing machine: quiet";
  return `May closing machine: ${report.counts.hot} hot · ${report.counts.warm} warm · ${report.counts.cold} cold — default close: 1-case starter order`;
}
