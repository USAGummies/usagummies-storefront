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

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: vi.fn(async () => true),
}));

vi.mock("@/lib/ops/qbo-client", () => ({
  createQBOVendor: vi.fn(async () => ({ Vendor: { Id: "999" } })),
}));

vi.mock("@/lib/notion/credentials", () => ({
  getNotionApiKey: vi.fn(() => ""),
  getNotionCredential: vi.fn(() => ""),
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

let approvalStoreRef: InMemoryApprovalStore;
let approvalSurfaceRef: StubApprovalSurface;

function req(body: unknown): Request {
  return new Request("http://localhost/api/ops/vendors/onboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  approvalStoreRef = new InMemoryApprovalStore();
  approvalSurfaceRef = new StubApprovalSurface();
  __resetStores();
  __resetSurfaces();
  __setStoresForTest({
    approval: approvalStoreRef,
    audit: new InMemoryAuditStore(),
  });
  __setSurfacesForTest({
    approval: approvalSurfaceRef,
    audit: new StubAuditSurface(),
  });
  const { kv } = await import("@vercel/kv");
  (kv as unknown as { __store: Map<string, unknown> }).__store.clear();
  vi.clearAllMocks();
});

describe("POST /api/ops/vendors/onboard", () => {
  it("opens a canonical vendor.master.create approval and does not write QBO yet", async () => {
    const { POST } = await import("../route");
    const { createQBOVendor } = await import("@/lib/ops/qbo-client");

    const res = await POST(req({
      name: "Snow Leopard Ventures LLC",
      email: "ap@snowleopard.example",
      phone: "555-0100",
      terms: "Net 10",
      w9DriveUrl: "https://drive.google.com/file/d/abc123/view",
    }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      approvalId: string;
      payloadRef: string;
      dedupeKey: string;
    };
    expect(body.ok).toBe(true);
    expect(body.approvalId).toBeTruthy();
    expect(body.payloadRef).toMatch(/^vendor-onboarding:payload:/);

    const stored = await approvalStoreRef.get(body.approvalId);
    expect(stored?.action).toBe("Create a new vendor master record (QBO + Notion + Drive)");
    expect(stored?.requiredApprovers).toEqual(["Rene"]);
    expect(stored?.targetEntity?.type).toBe("vendor-master");
    expect(stored?.payloadRef).toBe(body.payloadRef);
    expect(stored?.status).toBe("pending");
    expect(approvalSurfaceRef.surfaced).toHaveLength(1);

    expect(createQBOVendor).not.toHaveBeenCalled();
  });

  it("rejects invalid email before opening an approval", async () => {
    const { POST } = await import("../route");
    const res = await POST(req({ name: "Bad Email Vendor", email: "not-an-email" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/email/);
    expect(approvalStoreRef._size).toBe(0);
  });

  it("dedupes pending vendor approvals by email/name", async () => {
    const { POST } = await import("../route");
    const first = await POST(req({ name: "Repeat Vendor", email: "repeat@example.com" }));
    expect(first.status).toBe(200);

    const second = await POST(req({ name: "Repeat Vendor LLC", email: "repeat@example.com" }));
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toMatch(/pending/);
  });
});
