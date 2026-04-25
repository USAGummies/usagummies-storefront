import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetStores,
  __setStoresForTest,
} from "@/lib/ops/control-plane/stores";
import {
  __resetSurfaces,
  __setSurfacesForTest,
} from "@/lib/ops/control-plane/slack";
import {
  InMemoryApprovalStore,
  InMemoryAuditStore,
} from "@/lib/ops/control-plane/stores/memory-stores";
import type {
  ApprovalRequest,
  AuditLogEntry,
} from "@/lib/ops/control-plane/types";

vi.mock("@/lib/notion/credentials", () => ({
  getNotionApiKey: vi.fn(() => ""),
  getNotionCredential: vi.fn(() => ""),
}));

vi.mock("@/lib/notion/client", () => ({
  toNotionId: (raw: string) => raw,
}));

vi.mock("@/lib/ops/qbo-client", () => ({
  createQBOVendor: vi.fn(async () => ({ Vendor: { Id: "12345" } })),
}));

vi.mock("@vercel/kv", () => {
  const store = new Map<string, unknown>();
  return {
    kv: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown) => {
        store.set(key, value);
        return "OK";
      }),
      del: vi.fn(async (key: string) => {
        const existed = store.delete(key);
        return existed ? 1 : 0;
      }),
      __store: store,
    },
  };
});

import { kv } from "@vercel/kv";
import { createQBOVendor } from "@/lib/ops/qbo-client";
import {
  executeApprovedVendorMasterCreate,
  normalizeVendorKey,
  parseVendorOnboardingInput,
} from "../vendor-onboarding";

class StubApprovalSurface {
  surfaced: ApprovalRequest[] = [];
  updated: ApprovalRequest[] = [];
  async surfaceApproval(r: ApprovalRequest) {
    this.surfaced.push(structuredClone(r));
    return { channel: "ops-approvals" as const, ts: `ts-${r.id}` };
  }
  async updateApproval(r: ApprovalRequest) {
    this.updated.push(structuredClone(r));
  }
}

class StubAuditSurface {
  mirrored: AuditLogEntry[] = [];
  async mirror(e: AuditLogEntry) {
    this.mirrored.push(structuredClone(e));
  }
}

function buildApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  const now = new Date().toISOString();
  return {
    id: "approval-vendor-1",
    runId: "run-vendor-1",
    division: "financials",
    actorAgentId: "vendor-onboarding",
    class: "B",
    action: "Create a new vendor master record (QBO + Notion + Drive)",
    targetSystem: "qbo",
    targetEntity: { type: "vendor-master", id: "vendor-key", label: "Snow Leopard" },
    payloadPreview: "Vendor: Snow Leopard",
    payloadRef: "vendor-onboarding:payload:abc",
    evidence: {
      claim: "Create vendor master for Snow Leopard",
      sources: [{ system: "test", id: "abc", retrievedAt: now }],
      confidence: 0.9,
    },
    rollbackPlan: "Deactivate QBO vendor if wrong.",
    requiredApprovers: ["Rene"],
    status: "approved",
    createdAt: now,
    decisions: [{ approver: "Rene", decision: "approve", decidedAt: now }],
    escalateAt: now,
    expiresAt: now,
    slackThread: { channel: "ops-approvals", ts: "ts-vendor" },
    ...overrides,
  };
}

async function seedPayload() {
  const input = {
    name: "Snow Leopard Ventures LLC",
    companyName: "Snow Leopard Ventures LLC",
    email: "ap@snowleopard.example",
    terms: "Net 10",
    taxIdentifier: "12-3456789",
    w9DriveUrl: "https://drive.google.com/file/d/w9/view",
  };
  const dedupeKey = normalizeVendorKey(input);
  await kv.set("vendor-onboarding:payload:abc", JSON.stringify({
    kind: "vendor-onboarding-v1",
    input,
    dedupeKey,
    createdAt: new Date().toISOString(),
  }));
  return { input, dedupeKey };
}

beforeEach(() => {
  __resetStores();
  __resetSurfaces();
  __setStoresForTest({
    approval: new InMemoryApprovalStore(),
    audit: new InMemoryAuditStore(),
  });
  __setSurfacesForTest({
    approval: new StubApprovalSurface(),
    audit: new StubAuditSurface(),
  });
  (kv as unknown as { __store: Map<string, unknown> }).__store.clear();
  vi.clearAllMocks();
});

describe("vendor-onboarding", () => {
  it("parses form input and normalizes dedupe key", () => {
    const parsed = parseVendorOnboardingInput({
      name: " Snow Leopard Ventures LLC ",
      email: "AP@SnowLeopard.example ",
      zip: "82801",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.input.email).toBe("ap@snowleopard.example");
      expect(normalizeVendorKey(parsed.input)).toBe("ap@snowleopard.example");
    }
  });

  it("approved vendor.master.create creates QBO vendor, stores registry, and audits", async () => {
    const { dedupeKey } = await seedPayload();
    const result = await executeApprovedVendorMasterCreate(buildApproval());

    expect(result.ok).toBe(true);
    expect(result.handled).toBe(true);
    if (result.ok && result.handled) {
      expect(result.result.qboVendorId).toBe("12345");
      expect(result.threadMessage).toContain("QBO vendor ID");
      expect(result.threadMessage).toContain("No bill, PO, payment, or ACH release");
    }

    expect(createQBOVendor).toHaveBeenCalledWith(
      expect.objectContaining({
        DisplayName: "Snow Leopard Ventures LLC",
        CompanyName: "Snow Leopard Ventures LLC",
        TaxIdentifier: "12-3456789",
      }),
    );
    expect(await kv.get(`vendor-onboarding:registry:${dedupeKey}`)).toBeTruthy();
  });

  it("does not handle approvals that are not approved yet", async () => {
    await seedPayload();
    const result = await executeApprovedVendorMasterCreate(
      buildApproval({ status: "pending", decisions: [] }),
    );
    expect(result.handled).toBe(false);
    expect(createQBOVendor).not.toHaveBeenCalled();
  });

  it("fails closed when the stored payload is missing", async () => {
    const result = await executeApprovedVendorMasterCreate(buildApproval());
    expect(result.ok).toBe(false);
    expect(result.handled).toBe(true);
    if (!result.ok) {
      expect(result.error).toMatch(/missing stored payload/);
    }
    expect(createQBOVendor).not.toHaveBeenCalled();
  });
});
