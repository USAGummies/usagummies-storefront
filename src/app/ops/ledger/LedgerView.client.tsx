"use client";

/**
 * /ops/ledger — Rene's Ledger.
 *
 * One page for the finance-side queue work:
 *   1. CF-09 freight-comp JEs waiting for approve+post (Class B)
 *   2. Stale ShipStation voids with pending refunds
 *   3. Summary numbers — queue drain rate this week, pending $, etc.
 *
 * Polls /api/ops/fulfillment/freight-comp-queue + /api/ops/shipstation/voided-labels
 * every 60s. Rene clicks Approve + Post → QBO gets the paired JE;
 * clicks Reject → documented in KV with reason.
 */
import { useCallback, useEffect, useState } from "react";

import {
  NAVY,
  RED,
  GOLD,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";

const GREEN = "#16a34a";
const YELLOW = "#eab308";

interface FreightCompQueueEntry {
  key: string;
  queuedAt: string;
  channel: string;
  channelLabel: string;
  customerName: string;
  freightDollars: number;
  trackingNumbers: string[];
  customerRef: string;
  status: "queued" | "approved" | "posted" | "rejected";
}

interface FreightCompQueueData {
  ok: boolean;
  total: number;
  totals: {
    queued: number;
    approved: number;
    posted: number;
    rejected: number;
    queuedDollars: number;
    postedDollars: number;
  };
  entries: FreightCompQueueEntry[];
}

interface StaleVoid {
  shipmentId: number;
  carrierCode: string | null;
  serviceCode: string | null;
  trackingNumber: string | null;
  shipmentCost: number;
  voidDate: string;
  ageHours: number;
  shipToName: string | null;
  shipToPostalCode: string | null;
}

interface VoidedLabelsData {
  ok: boolean;
  stale: StaleVoid[];
  staleCount: number;
  stalePendingDollars: number;
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function LedgerView() {
  const [queue, setQueue] = useState<FreightCompQueueData | null>(null);
  const [voids, setVoids] = useState<VoidedLabelsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const [qRes, vRes] = await Promise.all([
        fetch("/api/ops/fulfillment/freight-comp-queue", { cache: "no-store" }),
        fetch("/api/ops/shipstation/voided-labels?daysBack=30", {
          cache: "no-store",
        }),
      ]);
      if (qRes.ok) setQueue((await qRes.json()) as FreightCompQueueData);
      if (vRes.ok) setVoids((await vRes.json()) as VoidedLabelsData);
      setError(null);
      setLastFetchedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const approve = useCallback(
    async (entry: FreightCompQueueEntry) => {
      if (
        !confirm(
          `Approve + post ${entry.customerName} freight-comp JE (${money(entry.freightDollars)}) to QBO?`,
        )
      ) {
        return;
      }
      setActionKey(entry.key);
      try {
        const res = await fetch("/api/ops/fulfillment/freight-comp-queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: entry.key, approver: "Rene" }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        }
        await load();
      } catch (err) {
        alert(`Approve failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setActionKey(null);
      }
    },
    [load],
  );

  const reject = useCallback(
    async (entry: FreightCompQueueEntry) => {
      const reason = prompt(
        `Reject ${entry.customerName} (${money(entry.freightDollars)})? Reason (≥8 chars):`,
        "",
      );
      if (!reason || reason.trim().length < 8) return;
      setActionKey(entry.key);
      try {
        const res = await fetch("/api/ops/fulfillment/freight-comp-queue", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: entry.key,
            rejectedBy: "Rene",
            reason: reason.trim(),
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        }
        await load();
      } catch (err) {
        alert(`Reject failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setActionKey(null);
      }
    },
    [load],
  );

  const pendingQueue = queue?.entries.filter((e) => e.status === "queued") ?? [];

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto", color: NAVY }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>
            💼 Rene&apos;s Ledger
          </h1>
          <div style={{ fontSize: 13, color: DIM, marginTop: 4 }}>
            Finance queue — CF-09 freight-comp + stale ShipStation refunds.
            Refreshes every 60s.
          </div>
        </div>
        {lastFetchedAt && (
          <span style={{ fontSize: 12, color: DIM }}>
            {lastFetchedAt.toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && (
        <div
          style={{
            border: `1px solid ${RED}55`,
            background: `${RED}0d`,
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 16,
            fontSize: 13,
            color: RED,
          }}
        >
          ❌ {error}
        </div>
      )}

      {/* Summary strip */}
      {queue && voids && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <Stat
            label="Queue · Pending"
            value={String(queue.totals.queued)}
            sub={money(queue.totals.queuedDollars)}
            color={queue.totals.queued > 0 ? YELLOW : GREEN}
          />
          <Stat
            label="Queue · Posted"
            value={String(queue.totals.posted)}
            sub={money(queue.totals.postedDollars)}
            color={GREEN}
          />
          <Stat
            label="Stale voids"
            value={String(voids.staleCount ?? 0)}
            sub={money(voids.stalePendingDollars ?? 0)}
            color={(voids.staleCount ?? 0) > 0 ? RED : GREEN}
          />
          <Stat
            label="Queue · Rejected"
            value={String(queue.totals.rejected)}
            color={DIM}
          />
        </div>
      )}

      {/* Pending freight-comp */}
      <section
        style={{
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          background: CARD,
          padding: 16,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.8,
              color: GOLD,
              textTransform: "uppercase",
            }}
          >
            CF-09 Freight-Comp · Pending JEs
          </div>
          <div style={{ fontSize: 12, color: DIM }}>
            {pendingQueue.length} queued
          </div>
        </div>

        {pendingQueue.length === 0 ? (
          <div style={{ fontSize: 13, color: DIM, fontStyle: "italic" }}>
            All clear — no pending freight-comp JEs.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <thead>
                <tr style={{ color: DIM, textAlign: "left" }}>
                  <Th>Queued</Th>
                  <Th>Customer</Th>
                  <Th>Channel</Th>
                  <Th>Freight</Th>
                  <Th>Ref</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {pendingQueue.map((e) => (
                  <tr
                    key={e.key}
                    style={{
                      borderTop: `1px dashed ${BORDER}`,
                      opacity: actionKey === e.key ? 0.5 : 1,
                    }}
                  >
                    <Td>{e.queuedAt.slice(0, 16).replace("T", " ")}</Td>
                    <Td>{e.customerName}</Td>
                    <Td>
                      <Code>{e.channelLabel}</Code>
                    </Td>
                    <Td>{money(e.freightDollars)}</Td>
                    <Td>
                      <Code>{e.customerRef}</Code>
                    </Td>
                    <Td>
                      <ActionButton
                        color={GREEN}
                        onClick={() => void approve(e)}
                        disabled={actionKey !== null}
                      >
                        Approve + Post
                      </ActionButton>
                      <ActionButton
                        color={RED}
                        onClick={() => void reject(e)}
                        disabled={actionKey !== null}
                      >
                        Reject
                      </ActionButton>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Stale voids */}
      <section
        style={{
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          background: CARD,
          padding: 16,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.8,
              color: GOLD,
              textTransform: "uppercase",
            }}
          >
            Stale ShipStation Voids · Awaiting Refund
          </div>
          <div style={{ fontSize: 12, color: DIM }}>
            {voids?.staleCount ?? 0} total · {money(voids?.stalePendingDollars ?? 0)}
          </div>
        </div>

        {!voids || voids.staleCount === 0 ? (
          <div style={{ fontSize: 13, color: DIM, fontStyle: "italic" }}>
            All clear — no stale void refunds pending.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <thead>
                <tr style={{ color: DIM, textAlign: "left" }}>
                  <Th>Voided</Th>
                  <Th>Age</Th>
                  <Th>Carrier</Th>
                  <Th>Tracking</Th>
                  <Th>Cost</Th>
                  <Th>Ship-to</Th>
                </tr>
              </thead>
              <tbody>
                {voids.stale.slice(0, 50).map((v) => (
                  <tr
                    key={v.shipmentId}
                    style={{
                      borderTop: `1px dashed ${BORDER}`,
                      color: v.ageHours > 30 * 24 ? RED : NAVY,
                    }}
                  >
                    <Td>{v.voidDate.slice(0, 10)}</Td>
                    <Td>{Math.round(v.ageHours / 24)}d</Td>
                    <Td>
                      <Code>{v.carrierCode ?? "?"}</Code>
                    </Td>
                    <Td>
                      <Code>{v.trackingNumber ?? "?"}</Code>
                    </Td>
                    <Td>{money(v.shipmentCost)}</Td>
                    <Td>
                      {v.shipToName ?? "?"}
                      {v.shipToPostalCode ? ` · ${v.shipToPostalCode}` : ""}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {voids.stale.length > 50 && (
              <div style={{ fontSize: 11, color: DIM, marginTop: 8 }}>
                Showing 50 of {voids.stale.length}
              </div>
            )}
          </div>
        )}
      </section>

      <div
        style={{
          marginTop: 22,
          padding: "12px 16px",
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          fontSize: 12,
          color: DIM,
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontWeight: 600, color: NAVY, marginBottom: 4 }}>
          How this page works
        </div>
        Approvals here post paired DEBIT 500050 Freight Out / CREDIT
        499010 Promotional Freight Comp journal entries to QBO per{" "}
        <Code>/contracts/distributor-pricing-commitments.md</Code> §5.
        Stale voids &gt;30d old are highlighted red — escalate to Stamps.com
        directly when they hit that threshold.
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 10,
        background: CARD,
        padding: 14,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: DIM,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color,
          marginTop: 4,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 12,
            color: DIM,
            marginTop: 2,
            fontFamily: "ui-monospace, Menlo, monospace",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  children,
  color,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  color: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        border: `1px solid ${color}55`,
        background: `${color}0f`,
        color,
        borderRadius: 6,
        padding: "4px 10px",
        fontSize: 11,
        fontWeight: 700,
        cursor: disabled ? "default" : "pointer",
        marginRight: 6,
      }}
    >
      {children}
    </button>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "6px 8px",
        fontWeight: 600,
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: 0.5,
      }}
    >
      {children}
    </th>
  );
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "8px 8px", verticalAlign: "top" }}>{children}</td>;
}
function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        fontFamily: "ui-monospace, Menlo, monospace",
        background: "rgba(27,42,74,0.04)",
        padding: "1px 5px",
        borderRadius: 4,
        fontSize: 11,
      }}
    >
      {children}
    </code>
  );
}
