/**
 * Tests for `readWholesaleInquiries()` in
 * `src/lib/ops/sales-command-readers.ts`.
 *
 * Locks the Phase 6 wired-by-default contract:
 *   - Successful read → SourceState.status="wired" with the count.
 *   - KV exception → SourceState.status="error" with reason
 *     (NEVER `wired:0` — no fabricated zero on outage).
 *   - Empty archive → SourceState.status="wired" total:0 (real,
 *     source-attested zero).
 *   - The slice's `anyAction` calculation does NOT trip on a
 *     positive wholesale count — stays as context, not action.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const summaryMock = vi.fn();

vi.mock("@/lib/wholesale/inquiries", () => ({
  getWholesaleInquirySummary: () => summaryMock(),
}));

import { composeSalesCommandSlice } from "../sales-command-center";
import { readWholesaleInquiries } from "../sales-command-readers";

beforeEach(() => {
  summaryMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// Helper to fabricate the other channels' SourceState so the slice
// composer has a complete input. Using `not_wired` keeps each test
// focused on the wholesale path.
import { sourceNotWired } from "../sales-command-center";
const notWired = (reason = "test") => sourceNotWired(reason);

const baseInput = () => ({
  faireInvites: notWired(),
  faireFollowUps: notWired(),
  pendingApprovals: notWired(),
  apPackets: notWired(),
  locationDrafts: notWired(),
});

describe("readWholesaleInquiries — wired/error/zero semantics", () => {
  it("returns wired with the summary on success", async () => {
    summaryMock.mockResolvedValueOnce({
      ok: true,
      summary: { total: 7, lastSubmittedAt: "2026-04-25T00:00:00Z" },
    });
    const state = await readWholesaleInquiries();
    expect(state.status).toBe("wired");
    if (state.status !== "wired") return;
    expect(state.value.total).toBe(7);
    expect(state.value.lastSubmittedAt).toBe("2026-04-25T00:00:00Z");
  });

  it("returns wired total:0 on empty-but-reachable archive (real zero)", async () => {
    summaryMock.mockResolvedValueOnce({
      ok: true,
      summary: { total: 0 },
    });
    const state = await readWholesaleInquiries();
    expect(state.status).toBe("wired");
    if (state.status !== "wired") return;
    expect(state.value.total).toBe(0);
  });

  it("KV exception → error (NOT wired:0) — no fabricated zero on outage", async () => {
    summaryMock.mockResolvedValueOnce({
      ok: false,
      reason: "KV read failed: ECONNREFUSED",
    });
    const state = await readWholesaleInquiries();
    expect(state.status).toBe("error");
    if (state.status !== "error") return;
    expect(state.reason).toContain("KV read failed");
  });
});

describe("Slice anyAction — wholesale stays context-only (morning brief stays quiet)", () => {
  it("a positive wholesale count does NOT trip anyAction", async () => {
    summaryMock.mockResolvedValueOnce({
      ok: true,
      summary: { total: 42, lastSubmittedAt: "2026-04-25T00:00:00Z" },
    });
    const wholesaleInquiries = await readWholesaleInquiries();
    const slice = composeSalesCommandSlice({
      ...baseInput(),
      wholesaleInquiries,
    });
    expect(slice.wholesaleInquiries).toBe(42);
    expect(slice.anyAction).toBe(false);
  });

  it("zero wholesale also doesn't trip anyAction (still context-only)", async () => {
    summaryMock.mockResolvedValueOnce({
      ok: true,
      summary: { total: 0 },
    });
    const wholesaleInquiries = await readWholesaleInquiries();
    const slice = composeSalesCommandSlice({
      ...baseInput(),
      wholesaleInquiries,
    });
    expect(slice.wholesaleInquiries).toBe(0);
    expect(slice.anyAction).toBe(false);
  });

  it("error state for wholesale → slice surfaces null (not 0) and still no anyAction trip", async () => {
    summaryMock.mockResolvedValueOnce({
      ok: false,
      reason: "KV outage",
    });
    const wholesaleInquiries = await readWholesaleInquiries();
    const slice = composeSalesCommandSlice({
      ...baseInput(),
      wholesaleInquiries,
    });
    // The slice composer maps non-wired SourceState to null —
    // already locked elsewhere; re-asserted here so the wholesale
    // error path inherits that contract.
    expect(slice.wholesaleInquiries).toBeNull();
    expect(slice.anyAction).toBe(false);
  });
});
