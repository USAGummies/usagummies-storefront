import { describe, expect, it } from "vitest";
import { extractEmailSignals } from "@/lib/ops/abra-operational-signals";

describe("abra-operational-signals", () => {
  it("filters noise senders", () => {
    const signals = extractEmailSignals({
      subject: "Marketing update",
      body: "nothing actionable",
      from: "noreply@example.com",
    });
    expect(signals).toEqual([]);
  });

  it("filters known noise domains", () => {
    const signals = extractEmailSignals({
      subject: "Claude email",
      body: "Routine notification",
      from: "updates@email.claude.com",
    });
    expect(signals).toEqual([]);
  });

  it("detects large order inquiries", () => {
    const signals = extractEmailSignals({
      subject: "Need 5,000 units fast",
      body: "We need 5,000 units for retail placement",
      from: "buyer@example.com",
    });
    expect(signals.some((signal) => signal.signal_type === "large_order")).toBe(true);
    expect(signals.find((signal) => signal.signal_type === "large_order")?.severity).toBe("critical");
  });

  it("detects complaints", () => {
    const signals = extractEmailSignals({
      subject: "Damaged order",
      body: "The shipment arrived damaged and we need a refund",
      from: "customer@example.com",
    });
    expect(signals.some((signal) => signal.signal_type === "complaint")).toBe(true);
    expect(signals.find((signal) => signal.signal_type === "complaint")?.severity).toBe("warning");
  });

  it("detects urgent requests", () => {
    const signals = extractEmailSignals({
      subject: "ASAP response needed",
      body: "This is urgent and needs immediate action",
      from: "partner@example.com",
      department: "finance",
    });
    expect(signals.some((signal) => signal.signal_type === "urgent_request")).toBe(true);
    expect(signals.find((signal) => signal.signal_type === "urgent_request")?.department).toBe("finance");
  });

  it("detects invoice and payment signals", () => {
    const signals = extractEmailSignals({
      subject: "Past due invoice",
      body: "Invoice is past due. Amount due is $1,250.00 net 30.",
      from: "vendor@example.com",
    });
    expect(signals.some((signal) => signal.signal_type === "payment_invoice")).toBe(true);
    expect(signals.find((signal) => signal.signal_type === "payment_invoice")?.severity).toBe("critical");
  });

  it("detects supplier updates", () => {
    const signals = extractEmailSignals({
      subject: "Allocation notice",
      body: "There is a price increase and allocation on the next order",
      from: "supplier@example.com",
    });
    expect(signals.some((signal) => signal.signal_type === "supplier_update")).toBe(true);
  });

  it("avoids false positives on routine business email", () => {
    const signals = extractEmailSignals({
      subject: "Weekly check-in",
      body: "Looking forward to speaking next week about next steps.",
      from: "normal@example.com",
    });
    expect(signals).toHaveLength(0);
  });
});
