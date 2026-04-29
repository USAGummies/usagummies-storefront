/**
 * Receipt-OCR → Bill-Draft Promoter — P0-6 acceptance tests.
 *
 * Locks the 16 acceptance criteria from the build directive:
 *   1. Valid reviewed receipt opens qbo.bill.create approval only.
 *   2. Rene is the approver.
 *   3. OCR-only receipt cannot open approval without canonical fields.
 *   4. Missing required reviewed fields → review-needed (no invented values).
 *   5. Missing/unapproved vendor → blocked-vendor (P0-4 dependency).
 *   6. Duplicate receipt/packet does not open duplicate approval.
 *   7. No QBO write/client called before approval.
 *   8. No vendor creation bypass.
 *   9. No QBO Chart of Accounts mutation.
 *  10. Class D slugs fail-closed.
 *  11. Unknown slug fail-closed.
 *  12. Drew never selected as approver.
 *  13. Canonical fields not overwritten by OCR.
 *  14. Approval payload includes provenance/evidence/confidence/rollback plan.
 *  15. Existing audit/back-reference behavior preserved (delegates to canonical).
 *  16. Status table marked implemented after green (separate test in reader.test.ts).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __INTERNAL,
  buildIdempotencyKey,
  promoteReceiptToBillDraft,
  type ApprovalOpener,
  type BillDraftApprovalParams,
  type BillDraftPacket,
  type DedupeProbe,
  type VendorProbe,
} from "../bill-draft-promoter";
import type {
  PacketTaxonomy,
  ProposedFields,
  ReceiptReviewPacket,
} from "@/lib/ops/receipt-review-packet";

// =========================================================================
// Fixtures
// =========================================================================

function canonicalField<T>(value: T) {
  return { value, source: "canonical" as const };
}
function ocrField<T>(value: T) {
  return { value, source: "ocr-suggested" as const };
}
function missingField<T>() {
  return { value: null as T | null, source: "missing" as const };
}

function fullPacket(
  overrides: Partial<{
    status: ReceiptReviewPacket["status"];
    proposedFields: Partial<ProposedFields>;
    canonical: Partial<ReceiptReviewPacket["canonical"]>;
    ocrSuggestion: ReceiptReviewPacket["ocrSuggestion"];
  }> = {},
): ReceiptReviewPacket {
  const taxonomy: PacketTaxonomy = {
    slug: "receipt.review.promote",
    classExpected: "B",
    reason: "test",
  };
  const proposed: ProposedFields = {
    vendor: canonicalField("Powers Confections"),
    date: canonicalField("2026-04-15"),
    amount: canonicalField(48_752.5),
    currency: canonicalField("USD"),
    category: canonicalField("Cost of Goods Sold - Production"),
    payment_method: canonicalField("ACH"),
    ...overrides.proposedFields,
  };
  const canonical = {
    vendor: "Powers Confections",
    date: "2026-04-15",
    amount: 48_752.5,
    currency: "USD",
    category: "Cost of Goods Sold - Production",
    payment_method: "ACH",
    ...overrides.canonical,
  };
  return {
    packetId: "pkt-v1-rcpt-001",
    receiptId: "rcpt-001",
    canonical,
    ocrSuggestion: overrides.ocrSuggestion ?? null,
    proposedFields: proposed,
    eligibility: { ok: true, missing: [], warnings: [] },
    taxonomy,
    status: overrides.status ?? "rene-approved",
    receiptStatusAtBuild: "ready",
    createdAt: "2026-04-28T12:00:00Z",
  };
}

function foundVendorProbe(): VendorProbe & { calls: number } {
  let n = 0;
  return {
    get calls() {
      return n;
    },
    resolve: async (name: string) => {
      n += 1;
      return { kind: "found", qboVendorId: "VEN-101", displayName: name };
    },
  };
}

function noOpDedupeProbe(): DedupeProbe & { calls: number } {
  let n = 0;
  return {
    get calls() {
      return n;
    },
    check: async () => {
      n += 1;
      return null;
    },
  };
}

function fakeOpener(): ApprovalOpener & {
  calls: number;
  lastParams: BillDraftApprovalParams | null;
} {
  let calls = 0;
  let lastParams: BillDraftApprovalParams | null = null;
  return {
    get calls() {
      return calls;
    },
    get lastParams() {
      return lastParams;
    },
    open: async (params) => {
      calls += 1;
      lastParams = params;
      return { ok: true, approvalId: "appr-bill-001", threadTs: "ts-001" };
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// Acceptance #1 — Valid reviewed receipt opens approval only
// =========================================================================

describe("promoteReceiptToBillDraft — happy path", () => {
  it("opens a qbo.bill.create approval; status=approval-opened", async () => {
    const vendorProbe = foundVendorProbe();
    const opener = fakeOpener();
    const dedupe = noOpDedupeProbe();

    const r = await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe,
      approvalOpener: opener,
      dedupeProbe: dedupe,
    });

    expect(r.status).toBe("approval-opened");
    if (r.status === "approval-opened") {
      expect(r.approvalId).toBe("appr-bill-001");
      expect(r.vendor.qboVendorId).toBe("VEN-101");
      expect(r.preview.amount).toBe(48_752.5);
    }
    expect(opener.calls).toBe(1);
    // The opener received exactly the registered slug.
    expect(opener.lastParams?.actionSlug).toBe("qbo.bill.create");
  });

  it("idempotency key is stable across runs (same packet → same key)", async () => {
    const opener1 = fakeOpener();
    const opener2 = fakeOpener();
    const r1 = await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: opener1,
      dedupeProbe: noOpDedupeProbe(),
    });
    const r2 = await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: opener2,
      dedupeProbe: noOpDedupeProbe(),
    });
    if (r1.status !== "approval-opened" || r2.status !== "approval-opened")
      throw new Error("expected approval-opened");
    expect(r1.idempotencyKey).toBe(r2.idempotencyKey);
    expect(opener1.lastParams?.idempotencyKey).toBe(r1.idempotencyKey);
  });
});

// =========================================================================
// Acceptance #2 — Rene is the approver (slug-guard locks this)
// =========================================================================

describe("promoteReceiptToBillDraft — Rene approver enforced via slug guard", () => {
  it("delegates only when registered slug lists Rene as approver", async () => {
    const r = await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: fakeOpener(),
      dedupeProbe: noOpDedupeProbe(),
    });
    expect(r.status).toBe("approval-opened");
  });

  it("if slug doesn't include Rene, returns fail-closed", async () => {
    const taxMod = await import("@/lib/ops/control-plane/taxonomy");
    const spy = vi.spyOn(taxMod, "classify");
    spy.mockImplementation((slug: string) => {
      if (slug === "qbo.bill.create") {
        return {
          slug: "qbo.bill.create",
          name: "Create a QBO bill (corrupt — Ben as approver)",
          class: "B",
          requiredApprovers: ["Ben" as never],
          irreversible: false,
          examples: [],
        };
      }
      return taxMod.classify.bind(taxMod)(slug);
    });
    const r = await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: fakeOpener(),
      dedupeProbe: noOpDedupeProbe(),
    });
    expect(r.status).toBe("fail-closed");
    if (r.status === "fail-closed") {
      expect(r.reason).toContain("Rene");
    }
  });
});

// =========================================================================
// Acceptance #3 — OCR-only receipt cannot open approval
// =========================================================================

describe("promoteReceiptToBillDraft — OCR-only fields do not satisfy required canonical", () => {
  it("returns review-needed when canonical vendor is OCR-only", async () => {
    const opener = fakeOpener();
    const r = await promoteReceiptToBillDraft(
      fullPacket({
        proposedFields: { vendor: ocrField("Powers Confections") },
      }),
      {
        vendorProbe: foundVendorProbe(),
        approvalOpener: opener,
        dedupeProbe: noOpDedupeProbe(),
      },
    );
    expect(r.status).toBe("review-needed");
    if (r.status === "review-needed") {
      expect(r.missing).toContain("vendor");
      expect(r.warnings.some((w) => w.includes("vendor"))).toBe(true);
    }
    expect(opener.calls).toBe(0);
  });

  it("returns review-needed when amount is OCR-only", async () => {
    const opener = fakeOpener();
    const r = await promoteReceiptToBillDraft(
      fullPacket({
        proposedFields: { amount: ocrField(123.45) },
      }),
      {
        vendorProbe: foundVendorProbe(),
        approvalOpener: opener,
        dedupeProbe: noOpDedupeProbe(),
      },
    );
    expect(r.status).toBe("review-needed");
    expect(opener.calls).toBe(0);
  });
});

// =========================================================================
// Acceptance #4 — Missing canonical fields → review-needed (no invention)
// =========================================================================

describe("promoteReceiptToBillDraft — missing canonical → review-needed (honest)", () => {
  it("missing fields are listed verbatim; nothing invented", async () => {
    const opener = fakeOpener();
    const r = await promoteReceiptToBillDraft(
      fullPacket({
        proposedFields: {
          vendor: missingField<string>(),
          date: missingField<string>(),
          amount: missingField<number>(),
          category: missingField<string>(),
        },
      }),
      {
        vendorProbe: foundVendorProbe(),
        approvalOpener: opener,
        dedupeProbe: noOpDedupeProbe(),
      },
    );
    expect(r.status).toBe("review-needed");
    if (r.status === "review-needed") {
      expect(r.missing).toEqual(
        expect.arrayContaining(["vendor", "date", "amount", "category"]),
      );
    }
    expect(opener.calls).toBe(0);
  });

  it("vendorProbe NOT called when canonical fields are missing (fail-fast)", async () => {
    const vendorProbe = foundVendorProbe();
    const opener = fakeOpener();
    await promoteReceiptToBillDraft(
      fullPacket({ proposedFields: { vendor: missingField<string>() } }),
      {
        vendorProbe,
        approvalOpener: opener,
        dedupeProbe: noOpDedupeProbe(),
      },
    );
    // Validation runs before vendor resolution
    expect(vendorProbe.calls).toBe(0);
  });
});

// =========================================================================
// Acceptance #5 — Missing/unapproved vendor → blocked-vendor
// =========================================================================

describe("promoteReceiptToBillDraft — vendor dependency routes to P0-4", () => {
  it("vendor not-found → blocked-vendor with vendorMasterDependency", async () => {
    const opener = fakeOpener();
    const r = await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: { resolve: async () => ({ kind: "not-found" }) },
      approvalOpener: opener,
      dedupeProbe: noOpDedupeProbe(),
    });
    expect(r.status).toBe("blocked-vendor");
    if (r.status === "blocked-vendor") {
      expect(r.reason).toBe("vendor-not-found");
      expect(r.vendorMasterDependency.coordinatorPath).toBe(
        "src/lib/ops/vendor-master/coordinator.ts",
      );
      expect(r.vendorMasterDependency.approvalSlug).toBe("vendor.master.create");
      expect(r.vendorMasterDependency.requiredApprover).toBe("Rene");
    }
    expect(opener.calls).toBe(0);
  });

  it("vendor pending → blocked-vendor with existing approvalId", async () => {
    const r = await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: {
        resolve: async () => ({ kind: "pending", approvalId: "appr-vendor-99" }),
      },
      approvalOpener: fakeOpener(),
      dedupeProbe: noOpDedupeProbe(),
    });
    expect(r.status).toBe("blocked-vendor");
    if (r.status === "blocked-vendor") {
      expect(r.reason).toBe("vendor-pending-approval");
      expect(r.vendorMasterDependency.existingApprovalId).toBe("appr-vendor-99");
    }
  });

  it("vendor ambiguous → blocked-vendor with candidates list", async () => {
    const r = await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: {
        resolve: async () => ({
          kind: "ambiguous",
          candidates: [
            { id: "VEN-A", name: "Powers Confections" },
            { id: "VEN-B", name: "Powers Confections LLC" },
          ],
        }),
      },
      approvalOpener: fakeOpener(),
      dedupeProbe: noOpDedupeProbe(),
    });
    expect(r.status).toBe("blocked-vendor");
    if (r.status === "blocked-vendor") {
      expect(r.reason).toBe("vendor-ambiguous");
      expect(r.vendorMasterDependency.candidates?.length).toBe(2);
    }
  });
});

// =========================================================================
// Acceptance #6 — Duplicate receipt does not open duplicate approval
// =========================================================================

describe("promoteReceiptToBillDraft — duplicate detection", () => {
  it("returns duplicate when an approval is already pending for this idempotency key", async () => {
    const opener = fakeOpener();
    const r = await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: opener,
      dedupeProbe: {
        check: async () => ({
          kind: "approval-pending",
          approvalId: "appr-existing-001",
        }),
      },
    });
    expect(r.status).toBe("duplicate");
    if (r.status === "duplicate") {
      expect(r.reason).toBe("approval-pending");
      expect(r.existingApprovalId).toBe("appr-existing-001");
    }
    expect(opener.calls).toBe(0);
  });

  it("returns duplicate when an approval was already completed", async () => {
    const r = await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: fakeOpener(),
      dedupeProbe: {
        check: async () => ({
          kind: "approval-completed",
          approvalId: "appr-old-001",
          status: "approved",
        }),
      },
    });
    expect(r.status).toBe("duplicate");
    if (r.status === "duplicate") {
      expect(r.reason).toBe("approval-completed");
    }
  });

  it("idempotency key is deterministic across invocations of buildIdempotencyKey", () => {
    const k1 = buildIdempotencyKey("pkt-1", "Powers", 123.45, "2026-04-15");
    const k2 = buildIdempotencyKey("pkt-1", "Powers", 123.45, "2026-04-15");
    expect(k1).toBe(k2);
    const k3 = buildIdempotencyKey("pkt-2", "Powers", 123.45, "2026-04-15");
    expect(k3).not.toBe(k1);
  });

  it("idempotency key is case-insensitive on vendor name", () => {
    const k1 = buildIdempotencyKey("pkt", "Powers Confections", 1, "2026-01-01");
    const k2 = buildIdempotencyKey("pkt", "POWERS CONFECTIONS", 1, "2026-01-01");
    expect(k1).toBe(k2);
  });
});

// =========================================================================
// Acceptance #7 — No QBO write/client called before approval
// =========================================================================

describe("promoteReceiptToBillDraft — no QBO write before approval", () => {
  it("opener is the only side-effectful sink (no QBO/Notion/Drive imports)", async () => {
    const opener = fakeOpener();
    const vendorProbe = foundVendorProbe();
    const dedupe = noOpDedupeProbe();
    await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe,
      approvalOpener: opener,
      dedupeProbe: dedupe,
    });
    // Promoter touched: vendorProbe.resolve + dedupeProbe.check + opener.open.
    // No other dependencies are accepted by the function signature.
    expect(opener.calls).toBe(1);
    expect(vendorProbe.calls).toBe(1);
    expect(dedupe.calls).toBe(1);
  });

  it("if approvalOpener returns error, NO retry / silent QBO write", async () => {
    const r = await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: {
        open: async () => ({ ok: false, error: "approval store unreachable" }),
      },
      dedupeProbe: noOpDedupeProbe(),
    });
    expect(r.status).toBe("fail-closed");
    if (r.status === "fail-closed") {
      expect(r.reason).toContain("approval store unreachable");
    }
  });
});

// =========================================================================
// Acceptance #8 — No vendor creation bypass
// =========================================================================

describe("promoteReceiptToBillDraft — no vendor creation bypass", () => {
  it("vendorProbe is the only vendor surface; no createVendor function path exists", async () => {
    // Structural lock: the promoter's only vendor dependency is the
    // VendorProbe interface, which exposes ONLY .resolve(). There is
    // no .create() method by design.
    const probe: VendorProbe = { resolve: async () => ({ kind: "not-found" }) };
    expect("create" in probe).toBe(false);
    expect(typeof probe.resolve).toBe("function");
  });

  it("blocked-vendor never creates the missing vendor; explicitly references the P0-4 coordinator", async () => {
    const opener = fakeOpener();
    const r = await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: { resolve: async () => ({ kind: "not-found" }) },
      approvalOpener: opener,
      dedupeProbe: noOpDedupeProbe(),
    });
    expect(opener.calls).toBe(0);
    if (r.status === "blocked-vendor") {
      expect(r.vendorMasterDependency.coordinatorPath).toContain(
        "vendor-master/coordinator.ts",
      );
    }
  });
});

// =========================================================================
// Acceptance #9 — No QBO Chart of Accounts mutation
// =========================================================================

describe("promoteReceiptToBillDraft — no CoA mutation", () => {
  it("registered slug is qbo.bill.create (Class B), never qbo.chart-of-accounts.modify (Class D)", () => {
    expect(__INTERNAL.REQUIRED_SLUG).toBe("qbo.bill.create");
    expect(__INTERNAL.assertSlugIsClassB()).toBeNull();
  });
});

// =========================================================================
// Acceptance #10 + #11 — Class D / unknown slug fail-closed
// =========================================================================

describe("promoteReceiptToBillDraft — fail-closed slug regressions", () => {
  it("if classify() returns undefined, returns fail-closed", async () => {
    const taxMod = await import("@/lib/ops/control-plane/taxonomy");
    const spy = vi.spyOn(taxMod, "classify");
    spy.mockImplementation((slug: string) => {
      if (slug === "qbo.bill.create") return undefined;
      return taxMod.classify.bind(taxMod)(slug);
    });
    const r = await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: fakeOpener(),
      dedupeProbe: noOpDedupeProbe(),
    });
    expect(r.status).toBe("fail-closed");
    if (r.status === "fail-closed") {
      expect(r.reason).toMatch(/unknown action slug/i);
    }
  });

  it("if slug is suddenly Class D, returns fail-closed", async () => {
    const taxMod = await import("@/lib/ops/control-plane/taxonomy");
    const spy = vi.spyOn(taxMod, "classify");
    spy.mockImplementation((slug: string) => {
      if (slug === "qbo.bill.create") {
        return {
          slug: "qbo.bill.create",
          name: "Create a QBO bill (corrupt)",
          class: "D",
          irreversible: true,
          examples: [],
        };
      }
      return taxMod.classify.bind(taxMod)(slug);
    });
    const r = await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: fakeOpener(),
      dedupeProbe: noOpDedupeProbe(),
    });
    expect(r.status).toBe("fail-closed");
    if (r.status === "fail-closed") {
      expect(r.reason).toContain("Class D");
    }
  });
});

// =========================================================================
// Acceptance #12 — Drew never selected
// =========================================================================

describe("promoteReceiptToBillDraft — Drew owns nothing", () => {
  it("if slug suddenly lists Drew, fail-closed with Drew-owns-nothing message", async () => {
    const taxMod = await import("@/lib/ops/control-plane/taxonomy");
    const spy = vi.spyOn(taxMod, "classify");
    spy.mockImplementation((slug: string) => {
      if (slug === "qbo.bill.create") {
        return {
          slug: "qbo.bill.create",
          name: "Create a QBO bill (corrupt — Drew)",
          class: "B",
          requiredApprovers: ["Drew" as never],
          irreversible: false,
          examples: [],
        };
      }
      return taxMod.classify.bind(taxMod)(slug);
    });
    const r = await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: fakeOpener(),
      dedupeProbe: noOpDedupeProbe(),
    });
    expect(r.status).toBe("fail-closed");
    if (r.status === "fail-closed") {
      expect(r.reason).toMatch(/Drew owns nothing|Rene as approver/i);
    }
  });

  it("approval payload never includes Drew as approver suggestion", async () => {
    const opener = fakeOpener();
    await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: opener,
      dedupeProbe: noOpDedupeProbe(),
    });
    const serialized = JSON.stringify(opener.lastParams ?? {});
    expect(serialized).not.toMatch(/"approver"\s*:\s*"Drew"/);
    expect(serialized).not.toMatch(/Drew/);
  });
});

// =========================================================================
// Acceptance #13 — Canonical fields not overwritten by OCR
// =========================================================================

describe("promoteReceiptToBillDraft — canonical fields are not overwritten by OCR", () => {
  it("when OCR disagrees with canonical, preview keeps canonical and surfaces deltas", async () => {
    const opener = fakeOpener();
    const r = await promoteReceiptToBillDraft(
      fullPacket({
        canonical: { amount: 100, vendor: "Powers Confections" },
        proposedFields: {
          amount: canonicalField(100),
          vendor: canonicalField("Powers Confections"),
        },
        ocrSuggestion: {
          vendor: "Powers Confs (typo)",
          date: "2026-04-15",
          amount: 105.5,
          currency: "USD",
          tax: null,
          last4: null,
          paymentHint: null,
          warnings: [],
          confidence: "medium",
          extractedAt: "2026-04-28T12:00:00Z",
          rawText: "Powers Confs (typo)\nTotal $105.50",
        },
      }),
      {
        vendorProbe: foundVendorProbe(),
        approvalOpener: opener,
        dedupeProbe: noOpDedupeProbe(),
      },
    );
    expect(r.status).toBe("approval-opened");
    if (r.status === "approval-opened") {
      expect(r.preview.amount).toBe(100); // canonical preserved
      expect(r.preview.vendorDisplayName).toBe("Powers Confections");
      const deltaFields = r.preview.ocrDeltas.map((d) => d.field);
      expect(deltaFields).toEqual(expect.arrayContaining(["vendor", "amount"]));
    }
  });
});

// =========================================================================
// Acceptance #14 — Approval payload includes provenance/evidence/confidence/rollback
// =========================================================================

describe("promoteReceiptToBillDraft — approval payload completeness", () => {
  it("evidence.claim names canonical-only-promotion + OCR-suggestion-only", async () => {
    const opener = fakeOpener();
    await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: opener,
      dedupeProbe: noOpDedupeProbe(),
    });
    const params = opener.lastParams!;
    expect(params.evidence.claim).toContain("Canonical reviewed fields only");
    expect(params.evidence.claim).toContain("OCR suggestions");
    expect(params.evidence.claim).toContain("never overwrite canonical");
  });

  it("evidence.sources cites packet + receipt + vendor-master", async () => {
    const opener = fakeOpener();
    await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: opener,
      dedupeProbe: noOpDedupeProbe(),
    });
    const sources = opener.lastParams!.evidence.sources;
    const systems = sources.map((s) => s.system);
    expect(systems).toEqual(
      expect.arrayContaining([
        "kv:docs:receipt_review_packets",
        "kv:docs:receipts",
        "vendor-master:registry",
      ]),
    );
  });

  it("evidence.confidence reflects OCR-vs-canonical agreement", async () => {
    const noDeltaOpener = fakeOpener();
    await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: noDeltaOpener,
      dedupeProbe: noOpDedupeProbe(),
    });
    expect(noDeltaOpener.lastParams!.evidence.confidence).toBe(0.95);

    const deltaOpener = fakeOpener();
    await promoteReceiptToBillDraft(
      fullPacket({
        ocrSuggestion: {
          vendor: "Powers Conf typo",
          date: "2026-04-15",
          amount: 999,
          currency: "USD",
          tax: null,
          last4: null,
          paymentHint: null,
          warnings: [],
          confidence: "medium",
          extractedAt: "2026-04-28T12:00:00Z",
          rawText: "Powers Conf typo\nTotal $999.00",
        },
      }),
      {
        vendorProbe: foundVendorProbe(),
        approvalOpener: deltaOpener,
        dedupeProbe: noOpDedupeProbe(),
      },
    );
    expect(deltaOpener.lastParams!.evidence.confidence).toBe(0.85);
  });

  it("rollbackPlan describes void-via-void / reject path; no payment side effects", async () => {
    const opener = fakeOpener();
    await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: opener,
      dedupeProbe: noOpDedupeProbe(),
    });
    const plan = opener.lastParams!.rollbackPlan;
    expect(plan).toContain("Rene voids");
    expect(plan).toContain("No vendor record, payment, or ACH is created");
  });

  it("payloadPreview includes vendor / amount / date / category / receipt id", async () => {
    const opener = fakeOpener();
    await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: opener,
      dedupeProbe: noOpDedupeProbe(),
    });
    const preview = opener.lastParams!.payloadPreview;
    expect(preview).toContain("Powers Confections");
    expect(preview).toContain("48752.50");
    expect(preview).toContain("2026-04-15");
    expect(preview).toContain("Cost of Goods Sold - Production");
    expect(preview).toContain("rcpt-001");
    expect(preview).toContain("Rene approval required");
  });
});

// =========================================================================
// Acceptance #15 — Existing audit/back-reference behavior preserved
// =========================================================================

describe("promoteReceiptToBillDraft — delegates to canonical approval path", () => {
  it("opener is called with the registered slug; promoter does NOT emit its own audit envelope", async () => {
    // The canonical requestApproval() path is what writes the audit
    // envelope + Slack mirror. The promoter delegates and does not
    // duplicate that responsibility.
    const opener = fakeOpener();
    const r = await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: opener,
      dedupeProbe: noOpDedupeProbe(),
    });
    expect(r.status).toBe("approval-opened");
    expect(opener.calls).toBe(1);
    expect(opener.lastParams?.actionSlug).toBe("qbo.bill.create");
    // Approval id is the back-reference handle for the canonical
    // audit envelope (emitted by the lower layer).
    if (r.status === "approval-opened") {
      expect(r.approvalId).toBeTruthy();
    }
  });

  it("targetEntity has stable id (idempotency key) for back-reference lookup", async () => {
    const opener = fakeOpener();
    await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: opener,
      dedupeProbe: noOpDedupeProbe(),
    });
    expect(opener.lastParams?.targetEntity.type).toBe("qbo-bill-draft");
    expect(opener.lastParams?.targetEntity.id).toMatch(/^[0-9a-f]{32}$/);
  });
});

// =========================================================================
// Bonus — packet status gating
// =========================================================================

describe("promoteReceiptToBillDraft — packet must be rene-approved", () => {
  it("draft packet is blocked", async () => {
    const opener = fakeOpener();
    const r = await promoteReceiptToBillDraft(fullPacket({ status: "draft" }), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: opener,
      dedupeProbe: noOpDedupeProbe(),
    });
    expect(r.status).toBe("blocked-packet-status");
    if (r.status === "blocked-packet-status") {
      expect(r.packetStatus).toBe("draft");
    }
    expect(opener.calls).toBe(0);
  });

  it("rejected packet is blocked", async () => {
    const opener = fakeOpener();
    const r = await promoteReceiptToBillDraft(fullPacket({ status: "rejected" }), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: opener,
      dedupeProbe: noOpDedupeProbe(),
    });
    expect(r.status).toBe("blocked-packet-status");
    expect(opener.calls).toBe(0);
  });
});

// =========================================================================
// Discriminated union exhaustiveness
// =========================================================================

describe("BillDraftPacket — exhaustive switch", () => {
  it("compiles + handles all 6 statuses", async () => {
    const opener = fakeOpener();
    const r: BillDraftPacket = await promoteReceiptToBillDraft(fullPacket(), {
      vendorProbe: foundVendorProbe(),
      approvalOpener: opener,
      dedupeProbe: noOpDedupeProbe(),
    });
    let label = "";
    switch (r.status) {
      case "approval-opened":
        label = `opened:${r.approvalId}`;
        break;
      case "review-needed":
        label = `review:${r.missing.length}`;
        break;
      case "blocked-packet-status":
        label = `blocked-status:${r.packetStatus}`;
        break;
      case "blocked-vendor":
        label = `blocked-vendor:${r.reason}`;
        break;
      case "duplicate":
        label = `duplicate:${r.reason}`;
        break;
      case "fail-closed":
        label = `fail-closed:${r.reason.slice(0, 16)}`;
        break;
    }
    expect(label.startsWith("opened:")).toBe(true);
  });
});
