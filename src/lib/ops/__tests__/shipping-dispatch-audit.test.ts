/**
 * Phase 28e — dispatch audit emission helper.
 *
 * Locks the contract:
 *   - First-time mark: action="shipping.dispatch.mark", before=null,
 *     after={dispatchedAt, dispatchedBy, surface, postedThreadReply}.
 *   - Re-mark: same action, before={dispatchedAt: <prior ISO>}, after
 *     reflects the new stamp.
 *   - Clear: action="shipping.dispatch.clear", before={dispatchedAt:
 *     <prior ISO>}, after={dispatchedAt: null}.
 *   - entityId is `${source}:${orderNumber}`.
 *   - sourceCitations carries the source/orderNumber tuple.
 *   - Fail-soft: an auditStore.append throw resolves to {ok: false,
 *     error: <msg>} — NEVER rejects the promise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditLogEntry } from "@/lib/ops/control-plane/types";

const appendMock = vi.fn();
vi.mock("@/lib/ops/control-plane/stores", () => ({
  auditStore: () => ({ append: appendMock }),
}));

beforeEach(() => {
  appendMock.mockReset();
  appendMock.mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

describe("recordDispatchAudit", () => {
  it("emits a mark entry for a first-time stamp from the Slack reaction surface", async () => {
    const { recordDispatchAudit } = await import("../shipping-dispatch-audit");
    const result = await recordDispatchAudit({
      action: "shipping.dispatch.mark",
      surface: "slack-reaction",
      source: "amazon",
      orderNumber: "112-1111111-1111111",
      actorRef: "U_OPERATOR",
      before: null,
      after: "2026-04-26T18:00:00.000Z",
      postedThreadReply: true,
    });
    expect(result.ok).toBe(true);
    expect(appendMock).toHaveBeenCalledTimes(1);
    const entry = appendMock.mock.calls[0][0] as AuditLogEntry;
    expect(entry.action).toBe("shipping.dispatch.mark");
    expect(entry.entityId).toBe("amazon:112-1111111-1111111");
    expect(entry.entityType).toBe("shipping.shipment");
    expect(entry.before).toBeNull();
    expect(entry.after).toMatchObject({
      dispatchedAt: "2026-04-26T18:00:00.000Z",
      dispatchedBy: "U_OPERATOR",
      surface: "slack-reaction",
      postedThreadReply: true,
    });
    expect(entry.result).toBe("ok");
    expect(entry.sourceCitations).toEqual([
      { system: "amazon", id: "112-1111111-1111111" },
    ]);
  });

  it("emits a re-mark entry preserving the prior dispatchedAt as `before`", async () => {
    const { recordDispatchAudit } = await import("../shipping-dispatch-audit");
    await recordDispatchAudit({
      action: "shipping.dispatch.mark",
      surface: "ops-dashboard",
      source: "shopify",
      orderNumber: "1077",
      actorRef: "ops-dashboard",
      before: "2026-04-26T17:00:00.000Z",
      after: "2026-04-26T18:00:00.000Z",
      postedThreadReply: false,
    });
    const entry = appendMock.mock.calls[0][0] as AuditLogEntry;
    expect(entry.before).toEqual({
      dispatchedAt: "2026-04-26T17:00:00.000Z",
    });
    expect((entry.after as Record<string, unknown>).postedThreadReply).toBe(
      false,
    );
    expect((entry.after as Record<string, unknown>).surface).toBe(
      "ops-dashboard",
    );
  });

  it("emits a clear entry with after={dispatchedAt: null}", async () => {
    const { recordDispatchAudit } = await import("../shipping-dispatch-audit");
    await recordDispatchAudit({
      action: "shipping.dispatch.clear",
      surface: "slack-reaction",
      source: "amazon",
      orderNumber: "112-2222222-2222222",
      actorRef: "U_OPERATOR",
      before: "2026-04-26T18:00:00.000Z",
      after: null,
    });
    const entry = appendMock.mock.calls[0][0] as AuditLogEntry;
    expect(entry.action).toBe("shipping.dispatch.clear");
    expect(entry.before).toEqual({
      dispatchedAt: "2026-04-26T18:00:00.000Z",
    });
    expect(entry.after).toEqual({ dispatchedAt: null });
  });

  it("agentId reflects surface (slack-reaction vs ops-dashboard)", async () => {
    const { recordDispatchAudit } = await import("../shipping-dispatch-audit");

    await recordDispatchAudit({
      action: "shipping.dispatch.mark",
      surface: "slack-reaction",
      source: "amazon",
      orderNumber: "A1",
      actorRef: "U1",
      before: null,
      after: "2026-04-26T18:00:00.000Z",
    });
    expect(
      (appendMock.mock.calls[0][0] as AuditLogEntry).actorId,
    ).toBe("shipping-dispatch-reaction");

    appendMock.mockClear();
    await recordDispatchAudit({
      action: "shipping.dispatch.mark",
      surface: "ops-dashboard",
      source: "amazon",
      orderNumber: "A2",
      actorRef: "ops-dashboard",
      before: null,
      after: "2026-04-26T18:00:00.000Z",
    });
    expect(
      (appendMock.mock.calls[0][0] as AuditLogEntry).actorId,
    ).toBe("shipping-dispatch-dashboard");
  });

  it("auditStore.append throw is captured and returned as {ok:false, error}", async () => {
    appendMock.mockRejectedValueOnce(new Error("KV down"));
    const { recordDispatchAudit } = await import("../shipping-dispatch-audit");
    const result = await recordDispatchAudit({
      action: "shipping.dispatch.mark",
      surface: "ops-dashboard",
      source: "shopify",
      orderNumber: "1099",
      actorRef: null,
      before: null,
      after: "2026-04-26T18:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/KV down/);
  });

  it("entityId always concatenates source and orderNumber with a colon", async () => {
    const { recordDispatchAudit } = await import("../shipping-dispatch-audit");
    await recordDispatchAudit({
      action: "shipping.dispatch.mark",
      surface: "ops-dashboard",
      source: "manual",
      orderNumber: "MAN-2026-001",
      actorRef: null,
      before: null,
      after: "2026-04-26T18:00:00.000Z",
    });
    expect(
      (appendMock.mock.calls[0][0] as AuditLogEntry).entityId,
    ).toBe("manual:MAN-2026-001");
  });
});
