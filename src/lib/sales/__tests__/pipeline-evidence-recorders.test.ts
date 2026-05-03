/**
 * Pipeline evidence recorders coverage.
 *
 * Pins:
 *   - Every recorder no-ops when dealId is missing (returns reason)
 *   - Each recorder picks the right stage + evidenceType
 *   - Sample-shipped guard: only label/tracking types are accepted
 *   - safeAppend's caller gets `{recorded:true, evidenceId}` on
 *     success
 *   - On store error, the recorder returns `{recorded:false, reason}`
 *     instead of throwing (best-effort contract)
 */
import { describe, expect, it } from "vitest";

import {
  recordInterestEvidence,
  recordInvoiceEvidence,
  recordOrderEvidence,
  recordPaymentEvidence,
  recordQuoteEvidence,
  recordReorderEvidence,
  recordSampleDeliveredEvidence,
  recordSampleRequestEvidence,
  recordShipmentEvidence,
  recordVendorSetupEvidence,
} from "../pipeline-evidence-recorders";
import type { KvLikePipelineStore } from "../pipeline-evidence-store";

function makeStore(): KvLikePipelineStore & {
  data: Record<string, unknown>;
} {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async <T>(key: string) => (data[key] as T | undefined) ?? null,
    set: async (key, value) => {
      data[key] = value;
      return "OK";
    },
  };
}

const BASE = {
  source: "test",
  sourceId: "src-1",
  evidenceAt: "2026-05-02T18:00:00.000Z",
  actor: "test-recorder",
  confidence: 0.9,
};

describe("recorder no-ops on missing dealId", () => {
  const recorders = [
    () => recordInterestEvidence({ ...BASE, evidenceType: "buyer_reply_email" }),
    () =>
      recordSampleRequestEvidence({
        ...BASE,
        evidenceType: "sample_request_email",
      }),
    () =>
      recordShipmentEvidence({
        ...BASE,
        kind: "sample",
        evidenceType: "shipment_label",
      }),
    () => recordSampleDeliveredEvidence({ ...BASE }),
    () =>
      recordVendorSetupEvidence({
        ...BASE,
        evidenceType: "vendor_setup_request",
      }),
    () => recordQuoteEvidence({ ...BASE, evidenceType: "quote_email_sent" }),
    () => recordOrderEvidence({ ...BASE, evidenceType: "po_document" }),
    () => recordInvoiceEvidence({ ...BASE, evidenceType: "qbo_invoice_sent" }),
    () => recordPaymentEvidence({ ...BASE, evidenceType: "qbo_payment_record" }),
    () => recordReorderEvidence({ ...BASE, evidenceType: "second_po_document" }),
  ];
  it.each(recorders)("recorder %# returns recorded=false with reason", async (fn) => {
    const r = await fn();
    expect(r.recorded).toBe(false);
    expect(r.reason).toMatch(/missing dealId/);
  });
});

describe("recorder happy paths — write right stage + evidenceType", () => {
  it("recordShipmentEvidence(sample, shipment_label) → sample_shipped", async () => {
    const store = makeStore();
    const r = await recordShipmentEvidence({
      ...BASE,
      dealId: "deal-1",
      kind: "sample",
      evidenceType: "shipment_label",
      store,
    });
    expect(r.recorded).toBe(true);
    const written = store.data["sales:pipeline-evidence:deal-1"] as Array<{
      stage: string;
      evidenceType: string;
    }>;
    expect(written).toHaveLength(1);
    expect(written[0].stage).toBe("sample_shipped");
    expect(written[0].evidenceType).toBe("shipment_label");
  });

  it("recordShipmentEvidence(order, shipstation_shipment) → shipped", async () => {
    const store = makeStore();
    const r = await recordShipmentEvidence({
      ...BASE,
      dealId: "deal-1",
      kind: "order",
      evidenceType: "shipstation_shipment",
      store,
    });
    expect(r.recorded).toBe(true);
    const written = store.data["sales:pipeline-evidence:deal-1"] as Array<{
      stage: string;
    }>;
    expect(written[0].stage).toBe("shipped");
  });

  it("recordShipmentEvidence(sample, shipstation_shipment) is rejected — type mismatch for stage", async () => {
    const store = makeStore();
    const r = await recordShipmentEvidence({
      ...BASE,
      dealId: "deal-1",
      kind: "sample",
      evidenceType: "shipstation_shipment", // not valid for sample_shipped
      store,
    });
    expect(r.recorded).toBe(false);
    expect(r.reason).toMatch(/not valid for sample_shipped/);
    expect(store.data["sales:pipeline-evidence:deal-1"]).toBeUndefined();
  });

  it("recordPaymentEvidence(qbo_payment_record) → paid", async () => {
    const store = makeStore();
    await recordPaymentEvidence({
      ...BASE,
      dealId: "deal-1",
      evidenceType: "qbo_payment_record",
      store,
    });
    const written = store.data["sales:pipeline-evidence:deal-1"] as Array<{
      stage: string;
    }>;
    expect(written[0].stage).toBe("paid");
  });

  it("recordOrderEvidence(po_document) → po_received", async () => {
    const store = makeStore();
    await recordOrderEvidence({
      ...BASE,
      dealId: "deal-1",
      evidenceType: "po_document",
      store,
    });
    const written = store.data["sales:pipeline-evidence:deal-1"] as Array<{
      stage: string;
    }>;
    expect(written[0].stage).toBe("po_received");
  });

  it("recordVendorSetupEvidence(w9_request) → vendor_setup", async () => {
    const store = makeStore();
    await recordVendorSetupEvidence({
      ...BASE,
      dealId: "deal-1",
      evidenceType: "w9_request",
      store,
    });
    const written = store.data["sales:pipeline-evidence:deal-1"] as Array<{
      stage: string;
    }>;
    expect(written[0].stage).toBe("vendor_setup");
  });

  it("recordQuoteEvidence(quote_pdf_sent) → quote_sent", async () => {
    const store = makeStore();
    await recordQuoteEvidence({
      ...BASE,
      dealId: "deal-1",
      evidenceType: "quote_pdf_sent",
      store,
    });
    const written = store.data["sales:pipeline-evidence:deal-1"] as Array<{
      stage: string;
    }>;
    expect(written[0].stage).toBe("quote_sent");
  });

  it("recordInvoiceEvidence(qbo_invoice_sent) → invoice_sent", async () => {
    const store = makeStore();
    await recordInvoiceEvidence({
      ...BASE,
      dealId: "deal-1",
      evidenceType: "qbo_invoice_sent",
      store,
    });
    const written = store.data["sales:pipeline-evidence:deal-1"] as Array<{
      stage: string;
    }>;
    expect(written[0].stage).toBe("invoice_sent");
  });

  it("recordSampleDeliveredEvidence → sample_delivered", async () => {
    const store = makeStore();
    await recordSampleDeliveredEvidence({
      ...BASE,
      dealId: "deal-1",
      store,
    });
    const written = store.data["sales:pipeline-evidence:deal-1"] as Array<{
      stage: string;
      evidenceType: string;
    }>;
    expect(written[0].stage).toBe("sample_delivered");
    expect(written[0].evidenceType).toBe("shipment_delivery_confirmation");
  });

  it("recordReorderEvidence(second_po_document) → reordered", async () => {
    const store = makeStore();
    await recordReorderEvidence({
      ...BASE,
      dealId: "deal-1",
      evidenceType: "second_po_document",
      store,
    });
    const written = store.data["sales:pipeline-evidence:deal-1"] as Array<{
      stage: string;
    }>;
    expect(written[0].stage).toBe("reordered");
  });

  it("recordInterestEvidence(buyer_reply_email) → interested", async () => {
    const store = makeStore();
    await recordInterestEvidence({
      ...BASE,
      dealId: "deal-1",
      evidenceType: "buyer_reply_email",
      store,
    });
    const written = store.data["sales:pipeline-evidence:deal-1"] as Array<{
      stage: string;
    }>;
    expect(written[0].stage).toBe("interested");
  });
});

describe("recorder fail-soft on store throw", () => {
  it("returns recorded=false with reason — never throws", async () => {
    const broken: KvLikePipelineStore = {
      get: async () => null,
      set: async () => {
        throw new Error("kv-down");
      },
    };
    const r = await recordPaymentEvidence({
      ...BASE,
      dealId: "deal-x",
      evidenceType: "qbo_payment_record",
      store: broken,
    });
    expect(r.recorded).toBe(false);
    expect(r.reason).toMatch(/kv-down/);
  });
});

describe("recorder confidence default", () => {
  it("defaults confidence to 0.95 when not provided", async () => {
    const store = makeStore();
    // Construct an args object without confidence — destructure it out.
    const { confidence: _omitted, ...noConfidence } = BASE;
    void _omitted;
    await recordPaymentEvidence({
      ...noConfidence,
      dealId: "deal-1",
      evidenceType: "qbo_payment_record",
      store,
    });
    const written = store.data["sales:pipeline-evidence:deal-1"] as Array<{
      confidence: number;
    }>;
    expect(written[0].confidence).toBe(0.95);
  });
});
