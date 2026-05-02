import { describe, expect, it } from "vitest";

import {
  buildClosingMachineReport,
  classifyClosingRow,
  renderClosingMachineBriefLine,
} from "../may-closing-machine";
import type { HubSpotProactiveItem } from "../hubspot-proactive";

function item(overrides: Partial<HubSpotProactiveItem> = {}): HubSpotProactiveItem {
  return {
    id: "deal-1",
    kind: "stale_buyer",
    severity: "watch",
    label: "Buyer",
    detail: "Contacted · 8d idle",
    nextAction: "Send follow-up",
    source: "hubspot",
    href: "https://app.hubspot.com/contacts/deal/deal-1",
    ageDays: 8,
    ...overrides,
  };
}

describe("May closing machine", () => {
  it("classifies sample shipped as hot and pushes the 1-case close", () => {
    const row = classifyClosingRow(
      item({
        kind: "stale_sample",
        detail: "Sample shipped · 9d since update",
        nextAction: "Ask for taste reaction",
      }),
    );
    expect(row.temperature).toBe("hot");
    expect(row.lane).toBe("sample_shipped");
    expect(row.nextMove).toContain("1-case starter-order");
    expect(row.defaultCloseAsk).toContain("1-case starter order");
  });

  it("classifies pricing, vendor setup, PO, order shipped, and reorder lanes", () => {
    expect(classifyClosingRow(item({ detail: "Pricing requested" })).lane).toBe(
      "pricing_requested",
    );
    expect(classifyClosingRow(item({ detail: "Vendor setup paperwork" })).lane).toBe(
      "vendor_setup",
    );
    expect(classifyClosingRow(item({ detail: "PO likely" })).lane).toBe(
      "po_likely",
    );
    expect(classifyClosingRow(item({ detail: "First order shipped" })).lane).toBe(
      "order_shipped",
    );
    expect(classifyClosingRow(item({ detail: "Reorder due" })).lane).toBe(
      "reorder_due",
    );
  });

  it("groups lanes in money-board priority order without fabricating rows", () => {
    const report = buildClosingMachineReport([
      item({ id: "sample", kind: "stale_sample", detail: "Sample shipped" }),
      item({ id: "pricing", detail: "Pricing requested" }),
      item({ id: "call", kind: "open_call_task", detail: "Priority HIGH" }),
    ]);
    expect(report.counts).toEqual({ hot: 2, warm: 1, cold: 0, total: 3 });
    expect(report.lanes.map((l) => l.lane)).toEqual([
      "pricing_requested",
      "sample_shipped",
      "call_task",
    ]);
    expect(report.mantra).toContain("Every sample needs a decision");
  });

  it("brief line centers stage conversion, not activity", () => {
    expect(renderClosingMachineBriefLine(buildClosingMachineReport([]))).toBe(
      "May closing machine: quiet",
    );
    expect(
      renderClosingMachineBriefLine(
        buildClosingMachineReport([item({ detail: "Vendor setup paperwork" })]),
      ),
    ).toBe(
      "May closing machine: 1 hot · 0 warm · 0 cold — default close: 1-case starter order",
    );
  });
});
