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
  buildMondayActionList,
  deriveApPacketsStatus,
  deriveApprovalsStatus,
  deriveFreightStatus,
  deriveReceiptStatus,
  derivePromoteReviewPill,
  type ApPacketsPayload,
  type ControlPlaneApprovalsPayload,
  type FreightCompPayload,
  type PromoteReviewState,
  type ReceiptSummaryPayload,
  type SectionWiring,
} from "./data";

interface OcrSuggestionShape {
  vendor: string | null;
  date: string | null;
  amount: number | null;
  currency: string | null;
  tax: number | null;
  last4: string | null;
  paymentHint: string | null;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  extractedAt: string;
}

interface ReceiptListItem {
  id: string;
  vendor?: string;
  date?: string;
  amount?: number;
  category?: string;
  status: "needs_review" | "ready";
  missing_fields?: string[];
  notes?: string;
  source_channel?: string;
  processed_at: string;
  ocr_suggestion?: OcrSuggestionShape;
}

const STATUS_COLOR: Record<SectionWiring, string> = {
  wired: "#1f7a3a",
  empty: DIM,
  not_wired: "#a05a00",
  error: RED,
};

function money(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

async function fetchJson<T>(url: string): Promise<{ data: T | null; err: string | null }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!res.ok) {
      const msg =
        (data && typeof data === "object" && "error" in data
          ? String((data as { error?: unknown }).error)
          : null) || `HTTP ${res.status}`;
      return { data: null, err: msg };
    }
    return { data: data as T, err: null };
  } catch (err) {
    return { data: null, err: err instanceof Error ? err.message : String(err) };
  }
}

export function FinanceReviewView() {
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  const [receiptSummary, setReceiptSummary] = useState<ReceiptSummaryPayload | null>(null);
  const [receiptSummaryErr, setReceiptSummaryErr] = useState<string | null>(null);

  const [needsReview, setNeedsReview] = useState<ReceiptListItem[]>([]);
  const [needsReviewErr, setNeedsReviewErr] = useState<string | null>(null);

  const [approvals, setApprovals] = useState<ControlPlaneApprovalsPayload | null>(null);
  const [approvalsErr, setApprovalsErr] = useState<string | null>(null);

  const [freight, setFreight] = useState<FreightCompPayload | null>(null);
  const [freightErr, setFreightErr] = useState<string | null>(null);

  const [apPackets, setApPackets] = useState<ApPacketsPayload | null>(null);
  const [apPacketsErr, setApPacketsErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [summary, list, appr, fr, ap] = await Promise.all([
        fetchJson<ReceiptSummaryPayload>("/api/ops/docs/receipt?summary=true"),
        fetchJson<{ ok: boolean; receipts: ReceiptListItem[] }>(
          "/api/ops/docs/receipt?status=needs_review&limit=50",
        ),
        fetchJson<ControlPlaneApprovalsPayload>(
          "/api/ops/control-plane/approvals?mode=pending&limit=50",
        ),
        fetchJson<FreightCompPayload>(
          "/api/ops/fulfillment/freight-comp-queue?status=queued",
        ),
        fetchJson<ApPacketsPayload>("/api/ops/ap-packets"),
      ]);
      if (cancelled) return;
      setReceiptSummary(summary.data);
      setReceiptSummaryErr(summary.err);
      setNeedsReview(list.data?.receipts ?? []);
      setNeedsReviewErr(list.err);
      setApprovals(appr.data);
      setApprovalsErr(appr.err);
      setFreight(fr.data);
      setFreightErr(fr.err);
      setApPackets(ap.data);
      setApPacketsErr(ap.err);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const monday = useMemo(
    () =>
      buildMondayActionList({
        receipts: receiptSummary,
        approvals,
        freight,
        apPackets,
        receiptsErr: receiptSummaryErr,
        approvalsErr,
        freightErr,
        apPacketsErr,
      }),
    [
      receiptSummary,
      approvals,
      freight,
      apPackets,
      receiptSummaryErr,
      approvalsErr,
      freightErr,
      apPacketsErr,
    ],
  );

  const receiptStatus = deriveReceiptStatus(receiptSummary, receiptSummaryErr);
  const approvalsStatus = deriveApprovalsStatus(approvals, approvalsErr);
  const freightStatus = deriveFreightStatus(freight, freightErr);
  const apStatus = deriveApPacketsStatus(apPackets, apPacketsErr);

  return (
    <div style={{ background: BG, minHeight: "100vh", padding: "24px 28px" }}>
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <div>
          <div style={{ fontSize: 13, color: DIM, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Finance · Review-only
          </div>
          <h1 style={{ color: NAVY, fontSize: 26, margin: "4px 0 0 0" }}>
            Monday Finance Review
          </h1>
          <p style={{ color: DIM, fontSize: 13, marginTop: 4 }}>
            What Rene + Ben need to act on today, in one place. Read-only — every
            decision still goes through the existing Slack approval cards or the
            canonical decision endpoints.
          </p>
        </div>
        <button
          onClick={() => setRefreshTick((n) => n + 1)}
          disabled={loading}
          style={{
            background: NAVY,
            color: "#fff",
            border: 0,
            borderRadius: 6,
            padding: "8px 14px",
            cursor: loading ? "wait" : "pointer",
            fontSize: 13,
          }}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {/* ---- Monday action list ---- */}
      <section
        style={{
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          padding: "16px 20px",
          marginBottom: 20,
        }}
      >
        <h2 style={{ color: GOLD, fontSize: 13, textTransform: "uppercase", margin: 0 }}>
          Monday finance action list
        </h2>
        <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0 0" }}>
          {monday.map((item) => (
            <li
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "10px 0",
                borderTop: `1px dashed ${BORDER}`,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  minWidth: 60,
                  fontWeight: 700,
                  fontSize: 22,
                  color: item.count > 0 ? RED : DIM,
                  textAlign: "right",
                }}
                aria-label="count"
              >
                {item.count}
              </span>
              <span style={{ flex: 1 }}>
                <a
                  href={item.href}
                  style={{
                    color: NAVY,
                    fontWeight: 600,
                    fontSize: 14,
                    textDecoration: "none",
                  }}
                >
                  {item.title}
                </a>
                <div style={{ color: DIM, fontSize: 12, marginTop: 2 }}>{item.detail}</div>
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: STATUS_COLOR[item.status],
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                }}
              >
                {item.status === "wired"
                  ? "Live"
                  : item.status === "empty"
                    ? "Empty"
                    : item.status === "not_wired"
                      ? "Not wired"
                      : "Error"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ---- Receipts needing review ---- */}
      <Section
        anchor="receipts"
        title="Receipts needing review"
        status={receiptStatus.label}
        statusColor={STATUS_COLOR[receiptStatus.wiring]}
        href={`/api/ops/docs/receipt?status=needs_review&limit=200`}
      >
        {receiptSummary && receiptSummary.ok && (
          <div style={{ display: "flex", gap: 24, color: DIM, fontSize: 12, marginBottom: 10 }}>
            <span>Total: <b style={{ color: NAVY }}>{receiptSummary.total_receipts ?? 0}</b></span>
            <span>Needs review: <b style={{ color: RED }}>{receiptSummary.needs_review ?? 0}</b></span>
            <span>Ready: <b style={{ color: "#1f7a3a" }}>{receiptSummary.ready ?? 0}</b></span>
            <span>Total amount: <b style={{ color: NAVY }}>{money(receiptSummary.total_amount)}</b></span>
          </div>
        )}
        {needsReviewErr && (
          <p style={{ color: RED, fontSize: 12 }}>List error: {needsReviewErr}</p>
        )}
        {needsReview.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: DIM, textAlign: "left" }}>
                  <Th>Vendor</Th>
                  <Th>Date</Th>
                  <Th>Amount</Th>
                  <Th>Category</Th>
                  <Th>Missing</Th>
                  <Th>Source</Th>
                  <Th>Captured</Th>
                  <Th>Rene review</Th>
                </tr>
              </thead>
              <tbody>
                {needsReview.map((r) => (
                  <FragmentRow key={r.id} r={r} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            text={
              receiptStatus.wiring === "empty"
                ? "No receipts captured yet."
                : "Nothing in needs_review right now."
            }
          />
        )}
      </Section>

      {/* ---- Pending control-plane approvals ---- */}
      <Section
        anchor="approvals"
        title="Pending Class B/C approvals"
        status={approvalsStatus.label}
        statusColor={STATUS_COLOR[approvalsStatus.wiring]}
        href={`/api/ops/control-plane/approvals?mode=pending&limit=50`}
      >
        {(approvals?.approvals ?? []).length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: DIM, textAlign: "left" }}>
                  <Th>Action</Th>
                  <Th>Class</Th>
                  <Th>Approver</Th>
                  <Th>Target</Th>
                  <Th>Agent</Th>
                  <Th>Opened</Th>
                </tr>
              </thead>
              <tbody>
                {(approvals?.approvals ?? []).map((a) => (
                  <tr key={a.id} style={{ borderTop: `1px dashed ${BORDER}` }}>
                    <Td>{a.action}</Td>
                    <Td>{a.class}</Td>
                    <Td>{(a.requiredApprovers ?? []).join(" + ")}</Td>
                    <Td>
                      {a.targetEntity?.label ?? a.targetEntity?.id ?? a.targetEntity?.type ?? "—"}
                    </Td>
                    <Td style={{ color: DIM }}>{a.actorAgentId}</Td>
                    <Td style={{ color: DIM }}>{a.createdAt?.slice(0, 16)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 11, color: DIM, marginTop: 8 }}>
              Decide in Slack #ops-approvals — clicking the buttons there fires the
              canonical state machine. This page intentionally has no Approve / Reject
              buttons.
            </p>
          </div>
        ) : (
          <Empty text={approvalsStatus.label} />
        )}
      </Section>

      {/* ---- Freight-comp queue ---- */}
      <Section
        anchor="freight"
        title="Freight-comp queue"
        status={freightStatus.label}
        statusColor={STATUS_COLOR[freightStatus.wiring]}
        href={`/api/ops/fulfillment/freight-comp-queue?status=queued`}
      >
        {(freight?.entries ?? []).length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: DIM, textAlign: "left" }}>
                  <Th>Customer</Th>
                  <Th>Status</Th>
                  <Th>Freight $</Th>
                  <Th>Queued</Th>
                </tr>
              </thead>
              <tbody>
                {(freight?.entries ?? []).map((e) => (
                  <tr key={`${e.queuedAt}|${e.customerName}`} style={{ borderTop: `1px dashed ${BORDER}` }}>
                    <Td>{e.customerName}</Td>
                    <Td>{e.status}</Td>
                    <Td>{money(e.freightDollars)}</Td>
                    <Td style={{ color: DIM }}>{e.queuedAt?.slice(0, 16)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 11, color: DIM, marginTop: 8 }}>
              Approve via <code>POST /api/ops/fulfillment/freight-comp-queue</code> or
              dismiss via <code>DELETE</code>. Both run through Rene; this page is
              read-only.
            </p>
          </div>
        ) : (
          <Empty text={freightStatus.label} />
        )}
      </Section>

      {/* ---- AP packets ---- */}
      <Section
        anchor="ap-packets"
        title="AP packets"
        status={apStatus.label}
        statusColor={STATUS_COLOR[apStatus.wiring]}
        href={`/api/ops/ap-packets`}
      >
        {(apPackets?.packets ?? []).length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: DIM, textAlign: "left" }}>
                  <Th>Account</Th>
                  <Th>Status</Th>
                  <Th>AP email</Th>
                  <Th>Owner</Th>
                  <Th>Due window</Th>
                  <Th>Pricing flag</Th>
                </tr>
              </thead>
              <tbody>
                {(apPackets?.packets ?? []).map((p) => (
                  <tr key={p.slug} style={{ borderTop: `1px dashed ${BORDER}` }}>
                    <Td>{p.accountName}</Td>
                    <Td>{p.status}</Td>
                    <Td style={{ color: DIM }}>{p.apEmail ?? "—"}</Td>
                    <Td style={{ color: DIM }}>{p.owner ?? "—"}</Td>
                    <Td style={{ color: DIM }}>{p.dueWindow ?? "—"}</Td>
                    <Td>
                      {p.pricingNeedsReview ? (
                        <span style={{ color: RED, fontWeight: 600 }}>REVIEW</span>
                      ) : (
                        <span style={{ color: "#1f7a3a" }}>OK</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text={apStatus.label} />
        )}
      </Section>

      {/* ---- Footer notes ---- */}
      <p style={{ fontSize: 11, color: DIM, marginTop: 22 }}>
        This surface is read-only. No QBO bills are created, no Gmail sends, no Drive
        writes, no approval state changes happen from this page. Future QBO write
        actions on this page would be Class B and Rene-approved per
        <code> /contracts/approval-taxonomy.md</code>.
      </p>
    </div>
  );
}

// ---- Small layout primitives ---------------------------------------------

function Section(props: {
  anchor: string;
  title: string;
  status: string;
  statusColor: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={props.anchor}
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        padding: "16px 20px",
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <h2 style={{ color: NAVY, fontSize: 16, margin: 0 }}>{props.title}</h2>
        <span style={{ fontSize: 12, color: props.statusColor, fontWeight: 600 }}>
          {props.status}
        </span>
      </div>
      {props.children}
      {props.href && (
        <p style={{ fontSize: 11, color: DIM, marginTop: 10 }}>
          API:{" "}
          <a href={props.href} style={{ color: GOLD, textDecoration: "underline" }}>
            {props.href}
          </a>
        </p>
      )}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        color: DIM,
        fontSize: 12,
        background: BG,
        border: `1px dashed ${BORDER}`,
        borderRadius: 6,
      }}
    >
      {text}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "6px 10px", fontWeight: 600 }}>{children}</th>;
}

function Td({
  children,
  style,
  colSpan,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  colSpan?: number;
}) {
  return (
    <td style={{ padding: "6px 10px", ...style }} colSpan={colSpan}>
      {children}
    </td>
  );
}

const CONFIDENCE_COLOR: Record<"high" | "medium" | "low", string> = {
  high: "#1f7a3a",
  medium: GOLD,
  low: RED,
};

/**
 * Renders a receipt row plus, when present, a non-promotion review-only
 * sub-row showing the OCR suggestion. The sub-row is visually muted
 * and labelled "OCR" so reviewers can never confuse it with the
 * canonical (review-promoted) values.
 */
/**
 * Phase 11 button — POSTs to /api/ops/docs/receipt/promote-review and
 * captures the response. The route opens a Class B Rene approval when
 * the resulting packet's eligibility.ok is true; otherwise returns a
 * draft-only packet. UI renders the response inline as a colored pill.
 *
 * Read-only contract: no inline edit of canonical receipt fields.
 * The button NEVER auto-fires qbo.bill.create / vendor creation /
 * category guess. The pill display is derived purely by
 * `derivePromoteReviewPill(state)` so the rendering rules are
 * unit-testable in `data.ts`.
 */
const PILL_COLOR: Record<"neutral" | "amber" | "green" | "red", string> = {
  neutral: NAVY,
  amber: GOLD,
  green: "#1f7a3a",
  red: RED,
};

interface PromoteReviewResponse {
  ok?: boolean;
  packet?: {
    eligibility?: { ok?: boolean; missing?: string[] };
  };
  approval?:
    | {
        opened: true;
        id: string;
        status: string;
        requiredApprovers: string[];
        /** Phase 12 — Slack permalink. May be null in degraded mode. */
        permalink?: string | null;
      }
    | { opened: false; reason: string };
  error?: string;
  reason?: string;
}

interface PacketStatusResponse {
  ok?: boolean;
  packetStatus?: "draft" | "rene-approved" | "rejected";
  approvalStatus?: string | null;
  error?: string;
  reason?: string;
}

async function promoteReviewRequest(
  receiptId: string,
): Promise<PromoteReviewState> {
  try {
    const res = await fetch("/api/ops/docs/receipt/promote-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiptId }),
      cache: "no-store",
    });
    let body: PromoteReviewResponse | null = null;
    try {
      body = (await res.json()) as PromoteReviewResponse;
    } catch {
      body = null;
    }
    if (!res.ok || !body) {
      const reason =
        body?.error ?? body?.reason ?? `HTTP ${res.status} ${res.statusText}`;
      return { kind: "error", reason };
    }
    const approval = body.approval;
    if (approval && approval.opened === true) {
      return {
        kind: "opened",
        approvalId: approval.id,
        status: approval.status,
        requiredApprovers: approval.requiredApprovers,
        permalink:
          typeof approval.permalink === "string" && approval.permalink.length > 0
            ? approval.permalink
            : null,
        packetStatus: "draft",
      };
    }
    if (approval && approval.opened === false) {
      return {
        kind: "draft-only",
        reason: approval.reason,
        missing: body.packet?.eligibility?.missing,
      };
    }
    // Defensive: route returned 200 but no approval envelope.
    return {
      kind: "error",
      reason: "Route returned ok but no approval envelope.",
    };
  } catch (err) {
    return {
      kind: "error",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Phase 12 — read-only per-row poll. Once the operator clicks
 * "Request Rene review" and the packet is in "opened" state, we
 * poll the read-only status route every POLL_INTERVAL_MS for up to
 * POLL_MAX_TICKS ticks (3 minutes total). When the packet's status
 * flips to a terminal state (`rene-approved` / `rejected`), we
 * update the pill and stop polling.
 *
 * Hard rules:
 *   - GET-only. Never opens approvals, never mutates state.
 *   - Bounded — max 6 ticks per row, then stops. Operator can
 *     refresh the page to re-arm the poll if Rene takes longer.
 *   - On 404 / non-200 / network throw → stop silently. The pill
 *     keeps its last-known state.
 */
const POLL_INTERVAL_MS = 30_000;
const POLL_MAX_TICKS = 6;

async function fetchPacketStatus(
  packetId: string,
): Promise<PacketStatusResponse | null> {
  try {
    const res = await fetch(
      `/api/ops/docs/receipt-review-packets/${encodeURIComponent(packetId)}`,
      { method: "GET", cache: "no-store" },
    );
    if (!res.ok) return null;
    return (await res.json()) as PacketStatusResponse;
  } catch {
    return null;
  }
}

function FragmentRow({ r }: { r: ReceiptListItem }) {
  const sug = r.ocr_suggestion;
  const [promoteState, setPromoteState] = useState<PromoteReviewState>({
    kind: "idle",
  });
  const pill = derivePromoteReviewPill(promoteState);
  const isLoading = promoteState.kind === "loading";

  async function onClickPromote() {
    setPromoteState({ kind: "loading" });
    const next = await promoteReviewRequest(r.id);
    setPromoteState(next);
  }

  // Phase 12 — poll the status route once a packet is "opened".
  // Stops automatically on terminal status or after POLL_MAX_TICKS.
  useEffect(() => {
    if (promoteState.kind !== "opened") return;
    if (
      promoteState.packetStatus === "rene-approved" ||
      promoteState.packetStatus === "rejected"
    ) {
      return; // already terminal — no poll
    }
    const packetId = `pkt-v1-${r.id}`;
    let ticks = 0;
    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled) return;
      ticks += 1;
      const status = await fetchPacketStatus(packetId);
      if (cancelled) return;
      if (status && status.ok && status.packetStatus) {
        setPromoteState((current) => {
          if (current.kind !== "opened") return current;
          return { ...current, packetStatus: status.packetStatus };
        });
        if (
          status.packetStatus === "rene-approved" ||
          status.packetStatus === "rejected"
        ) {
          clearInterval(interval);
          return;
        }
      }
      if (ticks >= POLL_MAX_TICKS) clearInterval(interval);
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    promoteState.kind,
    promoteState.kind === "opened" ? promoteState.packetStatus : undefined,
    r.id,
  ]);

  return (
    <>
      <tr style={{ borderTop: `1px dashed ${BORDER}` }}>
        <Td>{r.vendor ?? "—"}</Td>
        <Td>{r.date ?? "—"}</Td>
        <Td>{r.amount ? `$${r.amount.toFixed(2)}` : "—"}</Td>
        <Td>{r.category ?? "—"}</Td>
        <Td>
          {(r.missing_fields ?? []).length > 0 ? (
            <span style={{ color: RED }}>
              {(r.missing_fields ?? []).join(", ")}
            </span>
          ) : (
            "—"
          )}
        </Td>
        <Td>{r.source_channel ?? "—"}</Td>
        <Td>{r.processed_at?.slice(0, 16)}</Td>
        <Td>
          <button
            type="button"
            onClick={onClickPromote}
            disabled={isLoading}
            style={{
              fontSize: 11,
              padding: "3px 8px",
              borderRadius: 4,
              border: `1px solid ${BORDER}`,
              background: "#fff",
              color: NAVY,
              cursor: isLoading ? "wait" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {isLoading ? "Requesting…" : "Request Rene review"}
          </button>
        </Td>
      </tr>
      {sug && (
        <tr style={{ background: BG }}>
          <Td
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: DIM,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              whiteSpace: "nowrap",
            }}
          >
            OCR · suggestion
          </Td>
          <Td style={{ fontSize: 11, color: DIM }}>{sug.vendor ?? "—"}</Td>
          <Td style={{ fontSize: 11, color: DIM }}>{sug.date ?? "—"}</Td>
          <Td style={{ fontSize: 11, color: DIM }}>
            {typeof sug.amount === "number"
              ? `${sug.currency ?? ""} $${sug.amount.toFixed(2)}`.trim()
              : "—"}
          </Td>
          <Td colSpan={4} style={{ fontSize: 11, color: DIM }}>
            <span
              style={{
                fontWeight: 700,
                color: CONFIDENCE_COLOR[sug.confidence],
                textTransform: "uppercase",
                marginRight: 8,
              }}
            >
              {sug.confidence}
            </span>
            {sug.last4 ? `card ····${sug.last4}` : ""}
            {sug.paymentHint ? `${sug.last4 ? " · " : ""}${sug.paymentHint}` : ""}
            {sug.tax !== null && sug.tax !== undefined
              ? ` · tax $${sug.tax.toFixed(2)}`
              : ""}
            {sug.warnings.length > 0 && (
              <span style={{ color: RED, marginLeft: 8 }}>
                ⚠ {sug.warnings.join("; ")}
              </span>
            )}
            <span style={{ display: "block", marginTop: 2, color: DIM }}>
              Suggestion only — review fields above are unchanged.
            </span>
          </Td>
        </tr>
      )}
      {/* Phase 11 — promote-review pill (rendered only after operator clicks). */}
      {promoteState.kind !== "idle" && (
        <tr style={{ background: BG }}>
          <Td
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: DIM,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              whiteSpace: "nowrap",
            }}
          >
            Promote
          </Td>
          <Td colSpan={7} style={{ fontSize: 11 }}>
            <span
              style={{
                fontWeight: 700,
                color: PILL_COLOR[pill.color],
                marginRight: 8,
              }}
            >
              {pill.label}
            </span>
            {pill.detail && (
              <span style={{ color: DIM }}>{pill.detail}</span>
            )}
            {pill.permalink && (
              <a
                href={pill.permalink}
                target="_blank"
                rel="noopener noreferrer"
                style={{ marginLeft: 8, color: PILL_COLOR[pill.color] }}
              >
                Open thread →
              </a>
            )}
            <span
              style={{ display: "block", marginTop: 2, color: DIM }}
            >
              Read-only — review fields above are unchanged. QBO posting
              still runs through a separate `qbo.bill.create` action.
            </span>
          </Td>
        </tr>
      )}
    </>
  );
}
