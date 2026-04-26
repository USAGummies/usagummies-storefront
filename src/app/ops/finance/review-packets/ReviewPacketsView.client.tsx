"use client";

import { useEffect, useMemo, useState } from "react";

import {
  NAVY,
  RED,
  GOLD,
  CREAM as BG,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";

import {
  applyReviewPacketsFilters,
  buildReviewPacketsView,
  formatAmountCell,
  formatLookupFreshness,
  formatVendorCell,
  reviewPacketsFilterSpecToQuery,
  type ReviewPacketRowStatus,
  type ReviewPacketStatusColor,
  type ReviewPacketsApprovalStatusFilter,
  type ReviewPacketsFilterSpec,
  type ReviewPacketsView as ReviewPacketsViewShape,
} from "./data";

import type { ReceiptReviewPacket } from "@/lib/ops/receipt-review-packet";

const PILL_COLOR: Record<ReviewPacketStatusColor, string> = {
  amber: GOLD,
  green: "#1f7a3a",
  red: RED,
};

// Phase 15 — bounded passive poll. 60s × 10 = 10 min worst case.
// Locked by the no-noisy-poll discipline used in Phase 12's
// per-row poll. Operator interactions (filter change / manual
// refresh) reset the bound; failures stop the poll silently.
const POLL_INTERVAL_MS = 60_000;
const POLL_MAX_TICKS = 10;

interface ListResponse {
  ok?: boolean;
  count?: number;
  /** Phase 15 — count BEFORE the server-side filter; helps the
   *  operator see "filter narrowed N → M". Optional for backwards
   *  compat with older route versions. */
  totalBeforeFilter?: number;
  /** Phase 17 — full filtered length BEFORE pagination ("X of Y"). */
  matchedTotal?: number;
  /** Phase 15 — true when the route applied any filter. */
  filterApplied?: boolean;
  packets?: ReceiptReviewPacket[];
  /** Phase 16 — read-only approval lookup keyed by packetId.
   *  Optional for backwards compat. */
  approvals?: Record<string, { id: string; status: string }>;
  /** Phase 17 — opaque cursor for the next page. `null` when no
   *  more pages remain. */
  nextCursor?: string | null;
  /** Phase 24 — Unix-ms timestamp from the cached approval lookup,
   *  or `null` when freshly built. NEVER fabricated. */
  approvalsLookupCachedAt?: number | null;
  error?: string;
  reason?: string;
}

interface FetchResult {
  view: ReviewPacketsViewShape | null;
  /** Phase 17 — opaque cursor for the next page. Empty string when
   *  no more pages remain (mirrored from server's `nextCursor: null`). */
  nextCursor: string | null;
  /** Phase 17 — full filtered length BEFORE pagination. Lets the
   *  client render "showing X of Y" when paginating. */
  matchedTotal: number | null;
  /** Phase 24 — cache age metadata. `null` on fresh build / route
   *  error / route doesn't surface this field (older builds). */
  approvalsLookupCachedAt: number | null;
  err: string | null;
}

async function fetchPackets(
  spec: ReviewPacketsFilterSpec = {},
  options: { cursor?: string | null; limit?: number } = {},
): Promise<FetchResult> {
  try {
    const params = reviewPacketsFilterSpecToQuery(spec);
    params.set("limit", String(options.limit ?? 100));
    if (options.cursor) params.set("cursor", options.cursor);
    const res = await fetch(
      `/api/ops/docs/receipt-review-packets?${params.toString()}`,
      { method: "GET", cache: "no-store" },
    );
    let body: ListResponse | null = null;
    try {
      body = (await res.json()) as ListResponse;
    } catch {
      body = null;
    }
    if (!res.ok || !body || body.ok !== true) {
      const reason =
        body?.error ?? body?.reason ?? `HTTP ${res.status} ${res.statusText}`;
      return {
        view: null,
        nextCursor: null,
        matchedTotal: null,
        approvalsLookupCachedAt: null,
        err: reason,
      };
    }
    const packets = Array.isArray(body.packets) ? body.packets : [];
    // Phase 16 — rebuild the approval lookup map from the route's
    // flat object so each row picks up its approvalId / approvalStatus.
    const approvalsByPacketId = new Map<string, { id: string; status: string }>();
    if (body.approvals && typeof body.approvals === "object") {
      for (const [packetId, info] of Object.entries(body.approvals)) {
        if (
          info &&
          typeof info === "object" &&
          typeof info.id === "string" &&
          typeof info.status === "string"
        ) {
          approvalsByPacketId.set(packetId, info);
        }
      }
    }
    return {
      view: buildReviewPacketsView(packets, approvalsByPacketId),
      nextCursor: typeof body.nextCursor === "string" ? body.nextCursor : null,
      matchedTotal:
        typeof body.matchedTotal === "number" ? body.matchedTotal : null,
      approvalsLookupCachedAt:
        typeof body.approvalsLookupCachedAt === "number"
          ? body.approvalsLookupCachedAt
          : null,
      err: null,
    };
  } catch (err) {
    return {
      view: null,
      nextCursor: null,
      matchedTotal: null,
      approvalsLookupCachedAt: null,
      err: err instanceof Error ? err.message : String(err),
    };
  }
}

// Phase 24 — `formatLookupFreshness` lives in the server-safe
// `data.ts` module so it can be unit-tested without React baggage
// and shared with any future server-rendered surface. Imported above.

async function repromoteReceipt(
  receiptId: string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch("/api/ops/docs/receipt/promote-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiptId }),
      cache: "no-store",
    });
    if (!res.ok) {
      let body: { error?: string; reason?: string } = {};
      try {
        body = (await res.json()) as { error?: string; reason?: string };
      } catch {
        body = {};
      }
      return {
        ok: false,
        reason:
          body.error ?? body.reason ?? `HTTP ${res.status} ${res.statusText}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export function ReviewPacketsView() {
  const [view, setView] = useState<ReviewPacketsViewShape | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  // Phase 17 — pagination state. `nextCursor` is the opaque server
  // cursor for the next page; `null` means no more pages remain.
  // `matchedTotal` is the full filtered length (so we can render
  // "showing N of M"). `loadingMore` differentiates from initial
  // load so the table can stay rendered while fetching.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [matchedTotal, setMatchedTotal] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Phase 24 — cache age metadata. `null` on fresh build (cache
  // miss / route returned a fresh map). A number is the cached
  // value's `cachedAt` Unix-ms timestamp from Phase 19's
  // CachedShape — lets the indicator render "as of Xs ago".
  const [approvalsLookupCachedAt, setApprovalsLookupCachedAt] = useState<
    number | null
  >(null);
  // Phase 24 — clock tick that re-renders the indicator every
  // second so "as of 5s ago" advances live without refetching.
  // Uses a coarse 1s tick to keep CPU minimal.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  // pageCount: 1 = first page only; >1 = user clicked Load more.
  // Phase 15's bounded passive poll skips when pageCount > 1 to
  // avoid yanking the operator's accumulated rows mid-scroll.
  const [pageCount, setPageCount] = useState(1);

  // Phase 14 — operator filter state. Each input is a string so the
  // UI stays simple; the pure helper handles parsing + defensive
  // fallback to "no filter" on unparseable values.
  const [filterStatus, setFilterStatus] = useState<
    ReviewPacketRowStatus | "all"
  >("all");
  const [filterVendor, setFilterVendor] = useState<string>("");
  const [filterAfter, setFilterAfter] = useState<string>("");
  const [filterBefore, setFilterBefore] = useState<string>("");
  // Phase 16 — approval-status filter (control-plane state).
  const [filterApprovalStatus, setFilterApprovalStatus] =
    useState<ReviewPacketsApprovalStatusFilter>("any");
  // Phase 23 — id-substring search (packetId / receiptId / approvalId).
  // Operator pastes any id from a Slack thread, audit log, or CSV
  // row to find the matching packet.
  const [filterIdSearch, setFilterIdSearch] = useState<string>("");

  // Per-row re-promote feedback (Phase 14). Map: receiptId → state.
  // Cleared on refresh so a stale "queued" or "failed" can't linger
  // past a fresh load.
  const [repromote, setRepromote] = useState<
    Record<string, "loading" | "ok" | { error: string }>
  >({});

  // Filter spec captured before the fetch effect so the effect can
  // pass it to the route. Memoized so identity stays stable when
  // unrelated state changes — prevents fetch loops.
  const filterSpec: ReviewPacketsFilterSpec = useMemo(
    () => ({
      status: filterStatus,
      vendorContains: filterVendor,
      createdAfter: filterAfter,
      createdBefore: filterBefore,
      approvalStatus: filterApprovalStatus,
      idContains: filterIdSearch,
    }),
    [
      filterStatus,
      filterVendor,
      filterAfter,
      filterBefore,
      filterApprovalStatus,
      filterIdSearch,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPageCount(1); // fresh fetch → reset accumulation
    void fetchPackets(filterSpec).then((r) => {
      if (cancelled) return;
      setView(r.view);
      setErr(r.err);
      setLoading(false);
      setNextCursor(r.nextCursor);
      setMatchedTotal(r.matchedTotal);
      setApprovalsLookupCachedAt(r.approvalsLookupCachedAt);
      setRepromote({}); // fresh load → drop stale per-row pills
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, filterSpec]);

  // Phase 17 — Load more handler. Fetches the next page and APPENDS
  // its rows to the current view (preserves operator scroll state).
  // The defensive client-side filter belt re-runs on each render so
  // the appended rows are still constrained to the active filterSpec.
  async function onClickLoadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const r = await fetchPackets(filterSpec, { cursor: nextCursor });
    setLoadingMore(false);
    if (r.err) {
      setErr(r.err);
      return;
    }
    if (!r.view) return;
    setView((current) => {
      if (!current) return r.view;
      // Concatenate rows + recompute counts from the appended set.
      // Counts are trivial since rows already carry their status.
      const merged = [...current.rows, ...r.view!.rows];
      return {
        rows: merged,
        counts: {
          total: merged.length,
          draft: merged.filter((row) => row.status === "draft").length,
          reneApproved: merged.filter((row) => row.status === "rene-approved")
            .length,
          rejected: merged.filter((row) => row.status === "rejected").length,
        },
      };
    });
    setNextCursor(r.nextCursor);
    setPageCount((c) => c + 1);
    // Phase 24 — refresh the freshness indicator on Load more too;
    // the route's response carries the cachedAt for that fetch.
    setApprovalsLookupCachedAt(r.approvalsLookupCachedAt);
  }

  // Phase 15 — bounded passive poll. Refreshes the list every
  // POLL_INTERVAL_MS for at most POLL_MAX_TICKS ticks (10 min total
  // at default 60s × 10). Operator interactions reset the poll
  // (filter change → effect above re-fires; manual refresh →
  // refreshKey increments). On any failure or a final tick, the
  // poll stops silently. Bounded by design — matches Phase 12's
  // per-row poll discipline so the client stays cheap and
  // predictable.
  useEffect(() => {
    let ticks = 0;
    let cancelled = false;
    const id = setInterval(() => {
      if (cancelled) return;
      // Phase 17: skip the auto-refresh when the operator has loaded
      // additional pages. Yanking accumulated rows mid-scroll is
      // worse than slightly stale data; manual Refresh is one click.
      if (pageCount > 1) return;
      ticks += 1;
      setRefreshKey((k) => k + 1);
      if (ticks >= POLL_MAX_TICKS) clearInterval(id);
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // Re-arm whenever the filter changes (fresh user interaction).
    // refreshKey is intentionally NOT a dep — that would create a
    // tight loop with the increment inside the interval. pageCount
    // IS a dep so the poll re-evaluates the skip condition when the
    // operator clicks Load more.
  }, [filterSpec, pageCount]);

  // Defensive client-side filter belt. Server pre-filters via the
  // same canonical helper, so this re-application is a no-op on
  // already-filtered data — but it keeps the rendered view honest
  // even if a route version skews ahead of the client.
  const filteredView = useMemo(() => {
    if (!view) return null;
    return applyReviewPacketsFilters(view, filterSpec);
  }, [view, filterSpec]);

  const counts = filteredView?.counts ?? null;
  const rows = filteredView?.rows ?? [];
  const headerSummary = useMemo(() => {
    if (!counts) return "";
    return `${counts.total} packets · ${counts.draft} draft · ${counts.reneApproved} rene-approved · ${counts.rejected} rejected`;
  }, [counts]);

  async function onClickRepromote(receiptId: string) {
    setRepromote((cur) => ({ ...cur, [receiptId]: "loading" }));
    const res = await repromoteReceipt(receiptId);
    if (res.ok) {
      setRepromote((cur) => ({ ...cur, [receiptId]: "ok" }));
      // Refresh the list so any new approval / status change shows up.
      setRefreshKey((k) => k + 1);
    } else {
      setRepromote((cur) => ({
        ...cur,
        [receiptId]: { error: res.reason ?? "unknown error" },
      }));
    }
  }

  const filtersActive =
    filterStatus !== "all" ||
    filterVendor.trim().length > 0 ||
    filterAfter.trim().length > 0 ||
    filterBefore.trim().length > 0 ||
    filterApprovalStatus !== "any" ||
    filterIdSearch.trim().length > 0;

  return (
    <div style={{ background: BG, minHeight: "100vh", padding: 16 }}>
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          padding: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: DIM }}>FINANCE / RENE QUEUE</div>
            <h1 style={{ color: NAVY, fontSize: 22, margin: "4px 0 0 0" }}>
              Receipt review packets
            </h1>
            <p style={{ color: DIM, fontSize: 12, marginTop: 4 }}>
              Read-only aggregate view. Promote a receipt from{" "}
              <a href="/ops/finance/review" style={{ color: NAVY }}>
                /ops/finance/review
              </a>{" "}
              to add a row here. No QBO writes happen on this page.
            </p>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <a
              href={`/api/ops/docs/receipt-review-packets/export.csv?${(() => {
                const params = reviewPacketsFilterSpecToQuery(filterSpec);
                params.set("limit", "500");
                return params.toString();
              })()}`}
              // The browser handles the CSV download via
              // Content-Disposition: attachment from the route.
              // Phase 18 (Option A): read-only export of the
              // currently-filtered queue. Reuses the canonical
              // filter spec — same set the table is showing.
              style={{
                fontSize: 11,
                padding: "4px 10px",
                borderRadius: 4,
                border: `1px solid ${BORDER}`,
                background: "#fff",
                color: NAVY,
                cursor: "pointer",
                textDecoration: "none",
              }}
            >
              Export CSV
            </a>
            <button
              type="button"
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={loading}
              style={{
                fontSize: 11,
                padding: "4px 10px",
                borderRadius: 4,
                border: `1px solid ${BORDER}`,
                background: "#fff",
                color: NAVY,
                cursor: loading ? "wait" : "pointer",
              }}
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* ---- Filter strip (Phase 14) ---- */}
        <div
          style={{
            marginTop: 12,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
            fontSize: 11,
            color: DIM,
          }}
        >
          <label>
            Status:{" "}
            <select
              value={filterStatus}
              onChange={(e) =>
                setFilterStatus(
                  e.target.value as ReviewPacketRowStatus | "all",
                )
              }
              style={{
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 4,
                border: `1px solid ${BORDER}`,
                background: "#fff",
                color: NAVY,
              }}
            >
              <option value="all">All</option>
              <option value="draft">Draft</option>
              <option value="rene-approved">Rene approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <label>
            Vendor contains:{" "}
            <input
              type="text"
              value={filterVendor}
              onChange={(e) => setFilterVendor(e.target.value)}
              placeholder="e.g. belmark"
              style={{
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 4,
                border: `1px solid ${BORDER}`,
                background: "#fff",
                color: NAVY,
              }}
            />
          </label>
          <label>
            Created after:{" "}
            <input
              type="date"
              value={filterAfter}
              onChange={(e) => setFilterAfter(e.target.value)}
              style={{
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 4,
                border: `1px solid ${BORDER}`,
                background: "#fff",
                color: NAVY,
              }}
            />
          </label>
          <label>
            Created before:{" "}
            <input
              type="date"
              value={filterBefore}
              onChange={(e) => setFilterBefore(e.target.value)}
              style={{
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 4,
                border: `1px solid ${BORDER}`,
                background: "#fff",
                color: NAVY,
              }}
            />
          </label>
          <label>
            Approval:{" "}
            <select
              value={filterApprovalStatus}
              onChange={(e) =>
                setFilterApprovalStatus(
                  e.target.value as ReviewPacketsApprovalStatusFilter,
                )
              }
              style={{
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 4,
                border: `1px solid ${BORDER}`,
                background: "#fff",
                color: NAVY,
              }}
            >
              <option value="any">Any</option>
              <option value="no-approval">No approval</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="expired">Expired</option>
              <option value="stood-down">Stood down</option>
            </select>
          </label>
          <label>
            ID search:{" "}
            <input
              type="text"
              value={filterIdSearch}
              onChange={(e) => setFilterIdSearch(e.target.value)}
              placeholder="paste packet/receipt/approval id"
              style={{
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 4,
                border: `1px solid ${BORDER}`,
                background: "#fff",
                color: NAVY,
                minWidth: 200,
              }}
              title="Phase 23 — substring match on packetId, receiptId, or approvalId. Paste from a Slack thread or audit log to jump to that row."
            />
          </label>
          {filtersActive && (
            <button
              type="button"
              onClick={() => {
                setFilterStatus("all");
                setFilterVendor("");
                setFilterAfter("");
                setFilterBefore("");
                setFilterApprovalStatus("any");
                setFilterIdSearch("");
              }}
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 4,
                border: `1px solid ${BORDER}`,
                background: "#fff",
                color: NAVY,
                cursor: "pointer",
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        {/* ---- Counts strip ---- */}
        {headerSummary && (
          <div
            style={{
              marginTop: 12,
              fontSize: 12,
              color: DIM,
              borderTop: `1px solid ${BORDER}`,
              borderBottom: `1px solid ${BORDER}`,
              padding: "8px 0",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span>
              {headerSummary}
              {filtersActive && (
                <span style={{ marginLeft: 8, color: GOLD }}>(filtered)</span>
              )}
            </span>
            {/* Phase 24 — approval-lookup freshness indicator. Reads
             *   the cachedAt timestamp surfaced by the list route and
             *   renders "as of Xs ago" / "fresh". Closes the "is this
             *   stale?" question without forcing operators to click
             *   Refresh. The 1s clock tick (`now`) keeps the label
             *   advancing live. */}
            <span
              style={{ fontSize: 11, color: DIM }}
              title="Approval lookup freshness. Cache TTL is 30s; closer + Re-promote actions invalidate immediately (Phase 20 + Phase 22)."
            >
              Approvals: {formatLookupFreshness(approvalsLookupCachedAt, now)}
            </span>
          </div>
        )}

        {/* ---- Error / loading / empty ---- */}
        {err && (
          <p style={{ color: RED, fontSize: 12, marginTop: 12 }}>
            Failed to load packets: {err}
          </p>
        )}
        {loading && !view && (
          <p style={{ color: DIM, fontSize: 12, marginTop: 12 }}>Loading…</p>
        )}
        {view && rows.length === 0 && !err && (
          <p style={{ color: DIM, fontSize: 12, marginTop: 12 }}>
            {filtersActive
              ? "No packets match the current filters. Try clearing them."
              : "No review packets yet. Click “Request Rene review” on a receipt at /ops/finance/review to create one."}
          </p>
        )}

        {/* ---- Table ---- */}
        {rows.length > 0 && (
          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table
              style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
            >
              <thead>
                <tr style={{ color: DIM, textAlign: "left" }}>
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>
                    Status
                  </th>
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>
                    Packet
                  </th>
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>
                    Receipt
                  </th>
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>
                    Vendor
                  </th>
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>
                    Amount
                  </th>
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>
                    Eligibility
                  </th>
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>
                    Approval
                  </th>
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>
                    Created
                  </th>
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.packetId}
                    style={{ borderTop: `1px dashed ${BORDER}` }}
                  >
                    <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                      <span
                        style={{
                          color: PILL_COLOR[r.color],
                          fontWeight: 700,
                          textTransform: "uppercase",
                          fontSize: 10,
                          letterSpacing: 0.4,
                        }}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "6px 10px",
                        fontFamily: "monospace",
                        color: NAVY,
                      }}
                    >
                      {r.packetIdShort}
                    </td>
                    <td
                      style={{
                        padding: "6px 10px",
                        fontFamily: "monospace",
                        color: DIM,
                      }}
                    >
                      <a
                        href="/ops/finance/review#receipts"
                        style={{ color: DIM }}
                      >
                        {r.receiptId}
                      </a>
                    </td>
                    <td style={{ padding: "6px 10px" }}>
                      {formatVendorCell(r.vendor, r.vendorSource)}
                    </td>
                    <td style={{ padding: "6px 10px" }}>
                      {formatAmountCell(r.amountUsd, r.amountSource)}
                    </td>
                    <td style={{ padding: "6px 10px" }}>
                      {r.eligibilityOk ? (
                        <span style={{ color: "#1f7a3a" }}>OK</span>
                      ) : (
                        <span style={{ color: RED }}>
                          missing: {r.eligibilityMissing.join(", ") || "(none)"}
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: "6px 10px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.approvalStatus === null ? (
                        <span style={{ color: DIM, fontSize: 11 }}>
                          —
                        </span>
                      ) : (
                        <span
                          style={{
                            color:
                              r.approvalStatus === "approved"
                                ? "#1f7a3a"
                                : r.approvalStatus === "rejected"
                                  ? RED
                                  : r.approvalStatus === "pending"
                                    ? GOLD
                                    : DIM,
                            fontWeight: 600,
                            fontSize: 11,
                          }}
                        >
                          {r.approvalStatus}
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: "6px 10px",
                        color: DIM,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.createdAt.slice(0, 16)}
                    </td>
                    <td
                      style={{
                        padding: "6px 10px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {(() => {
                        const state = repromote[r.receiptId];
                        if (state === "loading") {
                          return (
                            <span style={{ color: DIM, fontSize: 11 }}>
                              Re-promoting…
                            </span>
                          );
                        }
                        if (state === "ok") {
                          return (
                            <span style={{ color: "#1f7a3a", fontSize: 11 }}>
                              Re-promote queued
                            </span>
                          );
                        }
                        if (state && typeof state === "object") {
                          return (
                            <span style={{ color: RED, fontSize: 11 }}>
                              Failed: {state.error}
                            </span>
                          );
                        }
                        return (
                          <button
                            type="button"
                            onClick={() => onClickRepromote(r.receiptId)}
                            style={{
                              fontSize: 11,
                              padding: "2px 8px",
                              borderRadius: 4,
                              border: `1px solid ${BORDER}`,
                              background: "#fff",
                              color: NAVY,
                              cursor: "pointer",
                            }}
                          >
                            Re-promote
                          </button>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ---- Phase 17: Load more pager ---- */}
        {rows.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginTop: 12,
              fontSize: 11,
              color: DIM,
            }}
          >
            <span>
              Showing <strong style={{ color: NAVY }}>{rows.length}</strong>
              {matchedTotal !== null && matchedTotal !== rows.length
                ? ` of ${matchedTotal}`
                : ""}
              {pageCount > 1 ? ` · ${pageCount} pages loaded` : ""}
            </span>
            {nextCursor ? (
              <button
                type="button"
                onClick={onClickLoadMore}
                disabled={loadingMore}
                style={{
                  fontSize: 11,
                  padding: "4px 10px",
                  borderRadius: 4,
                  border: `1px solid ${BORDER}`,
                  background: "#fff",
                  color: NAVY,
                  cursor: loadingMore ? "wait" : "pointer",
                }}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            ) : (
              <span>End of queue.</span>
            )}
          </div>
        )}

        <p style={{ marginTop: 16, fontSize: 11, color: DIM }}>
          Read-only. Approve / reject decisions still go through the Slack
          approval card in <code>#ops-approvals</code>. The closer (Phase 10)
          is what flips a packet from <code>draft</code> to{" "}
          <code>rene-approved</code> or <code>rejected</code>. QBO posting
          still runs through a separate <code>qbo.bill.create</code> Class B/C
          action.
        </p>
      </div>
    </div>
  );
}
