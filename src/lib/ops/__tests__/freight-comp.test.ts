/**
 * freight-comp.ts tests — paired JE construction, channel mapping.
 */
import { describe, expect, it } from "vitest";

import {
  FREIGHT_COMP_CHANNELS,
  buildFreightCompJournalEntry,
  type FreightCompChannel,
} from "../freight-comp";

describe("FREIGHT_COMP_CHANNELS", () => {
  it("defines all three canonical channels", () => {
    expect(FREIGHT_COMP_CHANNELS.distributor).toBeDefined();
    expect(FREIGHT_COMP_CHANNELS.trade_show).toBeDefined();
    expect(FREIGHT_COMP_CHANNELS.dtc_absorbed).toBeDefined();
  });

  it("each channel has a label", () => {
    for (const code of ["distributor", "trade_show", "dtc_absorbed"] as FreightCompChannel[]) {
      expect(FREIGHT_COMP_CHANNELS[code].label).toBeTruthy();
    }
  });
});

describe("buildFreightCompJournalEntry", () => {
  it("builds paired DEBIT 500050 / CREDIT 499010 at the same amount", () => {
    const je = buildFreightCompJournalEntry({
      freightCostDollars: 27.27,
      channel: "distributor",
      shipmentId: "139040327",
      trackingNumber: "9434650206217208486801",
      customerRef: "shopify-1016",
    });
    const lines = (je as unknown as { Line: Array<Record<string, unknown>> }).Line;
    expect(lines).toHaveLength(2);
    // Both lines carry the same dollar amount.
    expect(lines[0].Amount).toBe(27.27);
    expect(lines[1].Amount).toBe(27.27);
    const [debitLine, creditLine] = lines;
    const debitDetail = debitLine.JournalEntryLineDetail as Record<
      string,
      unknown
    >;
    const creditDetail = creditLine.JournalEntryLineDetail as Record<
      string,
      unknown
    >;
    expect(debitDetail.PostingType).toBe("Debit");
    expect(creditDetail.PostingType).toBe("Credit");
  });

  it("includes customerRef + tracking in line descriptions for audit trail", () => {
    const je = buildFreightCompJournalEntry({
      freightCostDollars: 15.5,
      channel: "trade_show",
      shipmentId: 12345,
      trackingNumber: "TRACK123",
      customerRef: "shopify-999",
    });
    const lines = (je as unknown as { Line: Array<Record<string, unknown>> }).Line;
    expect(String(lines[0].Description)).toContain("shopify-999");
    expect(String(lines[0].Description)).toContain("TRACK123");
  });

  it("rounds to 2 decimal places", () => {
    const je = buildFreightCompJournalEntry({
      freightCostDollars: 10.12345,
      channel: "dtc_absorbed",
      shipmentId: "x",
      trackingNumber: "y",
      customerRef: "z",
    });
    const lines = (je as unknown as { Line: Array<Record<string, unknown>> }).Line;
    expect(lines[0].Amount).toBe(10.12);
    expect(lines[1].Amount).toBe(10.12);
  });
});
