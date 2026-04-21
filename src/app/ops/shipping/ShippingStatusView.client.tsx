"use client";

/**
 * Shipping Status — live preflight dashboard.
 *
 * One-page "can I ship right now?" view for Ben. Polls
 * `/api/ops/fulfillment/preflight` every 30s, renders wallet balances,
 * ATP bags, freight-comp queue depth, and stale voids in a grid of
 * cards. Red when something is actionable, muted when clean.
 *
 * Consumes the same payload the Ops Agent digest + morning Exec Brief
 * use, so the view matches what Ben sees in Slack.
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

interface PreflightWallet {
  carrierCode: string;
  balance: number | null;
  floor: number;
  belowFloor: boolean;
}

interface PreflightData {
  ok: boolean;
  generatedAt: string;
  wallets: PreflightWallet[];
  walletDegraded: string | null;
  atp: {
    totalBagsOnHand: number | null;
    pendingOutboundBags: number;
    availableBags: number | null;
    snapshotAgeHours: number | null;
    unavailableReason?: string;
  };
  freightCompQueue: {
    queuedCount: number;
    queuedDollars: number;
    oldestAgeHours: number | null;
  };
  staleVoids: {
    count: number;
    pendingDollars: number;
    oldestAgeHours: number | null;
    unavailableReason?: string;
  };
  alerts: string[];
}

interface RecentLabel {
  shipmentId: number;
  orderNumber: string | null;
  trackingNumber: string | null;
  carrierCode: string | null;
  serviceCode: string | null;
  shipDate: string | null;
  createDate: string;
  voided: boolean;
  voidDate: string | null;
  shipmentCost: number | null;
  shipToName: string | null;
  shipToPostalCode: string | null;
}

interface RecentLabelsData {
  ok: boolean;
  totalCount: number;
  activeSpend: number;
  voidedSpend: number;
  byCarrier: Record<
    string,
    { active: number; voided: number; activeDollars: number }
  >;
  shipments: RecentLabel[];
}

const GREEN = "#16a34a";
const YELLOW = "#eab308";

function money(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function ShippingStatusView() {
  const [data, setData] = useState<PreflightData | null>(null);
  const [recent, setRecent] = useState<RecentLabelsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const [preflightRes, recentRes] = await Promise.all([
        fetch("/api/ops/fulfillment/preflight", { cache: "no-store" }),
        fetch("/api/ops/fulfillment/recent-labels?daysBack=7&limit=25", {
          cache: "no-store",
        }),
      ]);
      if (!preflightRes.ok) {
        const text = await preflightRes.text().catch(() => "");
        throw new Error(`preflight HTTP ${preflightRes.status}: ${text.slice(0, 200)}`);
      }
      const preflightJson = (await preflightRes.json()) as PreflightData;
      setData(preflightJson);
      // Recent labels is best-effort — the preflight is the primary.
      if (recentRes.ok) {
        const recentJson = (await recentRes.json()) as RecentLabelsData;
        setRecent(recentJson);
      }
      setError(null);
      setLastFetchedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

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
            🇺🇸 Shipping Status
          </h1>
          <div style={{ fontSize: 13, color: DIM, marginTop: 4 }}>
            Live preflight — can I buy a label right now? Refreshes every 30s.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {lastFetchedAt && (
            <span style={{ fontSize: 12, color: DIM }}>
              Updated {lastFetchedAt.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => void load()}
            disabled={loading}
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              background: CARD,
              color: NAVY,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
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

      {data && data.alerts.length > 0 && (
        <div
          style={{
            border: `1px solid ${RED}55`,
            background: `${RED}0d`,
            borderRadius: 10,
            padding: "14px 16px",
            marginBottom: 20,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8, color: RED }}>
            🚨 Active alerts
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {data.alerts.map((a, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && data.alerts.length === 0 && (
        <div
          style={{
            border: `1px solid ${GREEN}55`,
            background: `${GREEN}0d`,
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 20,
            fontSize: 13,
            color: GREEN,
            fontWeight: 600,
          }}
        >
          ✅ All clear — wallets above floor, ATP healthy, queue empty, no
          stale voids.
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 14,
        }}
      >
        {/* ---- Wallets ---- */}
        <Card title="Wallets">
          {!data && <Muted>Loading…</Muted>}
          {data && data.walletDegraded && (
            <Muted>Unavailable: {data.walletDegraded}</Muted>
          )}
          {data &&
            data.wallets.map((w) => (
              <Row key={w.carrierCode}>
                <Label>
                  <Code>{w.carrierCode}</Code>
                </Label>
                <Value
                  color={w.belowFloor ? RED : GREEN}
                  strong={w.belowFloor}
                >
                  {w.balance === null ? "—" : money(w.balance)}
                  <TailLabel>
                    /{" "}
                    <span style={{ color: DIM }}>
                      floor {money(w.floor)}
                    </span>
                  </TailLabel>
                </Value>
              </Row>
            ))}
        </Card>

        {/* ---- ATP ---- */}
        <Card title="ATP (Available-to-Promise)">
          {!data && <Muted>Loading…</Muted>}
          {data && data.atp.unavailableReason && (
            <Muted>Unavailable: {data.atp.unavailableReason}</Muted>
          )}
          {data && data.atp.totalBagsOnHand !== null && (
            <>
              <Row>
                <Label>On-hand</Label>
                <Value>{data.atp.totalBagsOnHand.toLocaleString()} bags</Value>
              </Row>
              <Row>
                <Label>Pending outbound</Label>
                <Value>
                  {data.atp.pendingOutboundBags.toLocaleString()} bags
                </Value>
              </Row>
              <Row>
                <Label strong>Available to ship</Label>
                <Value
                  color={
                    data.atp.availableBags !== null && data.atp.availableBags < 36
                      ? YELLOW
                      : GREEN
                  }
                  strong
                >
                  {data.atp.availableBags?.toLocaleString() ?? "—"} bags
                </Value>
              </Row>
              {data.atp.snapshotAgeHours !== null && (
                <Row>
                  <Label>Snapshot age</Label>
                  <Value
                    color={data.atp.snapshotAgeHours > 36 ? YELLOW : DIM}
                  >
                    {data.atp.snapshotAgeHours}h
                  </Value>
                </Row>
              )}
            </>
          )}
        </Card>

        {/* ---- Freight-comp queue ---- */}
        <Card title="CF-09 Freight-Comp Queue">
          {!data && <Muted>Loading…</Muted>}
          {data && (
            <>
              <Row>
                <Label>Queued JEs</Label>
                <Value
                  color={
                    data.freightCompQueue.queuedCount > 10 ? YELLOW : GREEN
                  }
                  strong={data.freightCompQueue.queuedCount > 10}
                >
                  {data.freightCompQueue.queuedCount}
                </Value>
              </Row>
              <Row>
                <Label>Pending $</Label>
                <Value>{money(data.freightCompQueue.queuedDollars)}</Value>
              </Row>
              {data.freightCompQueue.oldestAgeHours !== null && (
                <Row>
                  <Label>Oldest</Label>
                  <Value color={DIM}>
                    {data.freightCompQueue.oldestAgeHours}h
                  </Value>
                </Row>
              )}
              <Muted style={{ marginTop: 10 }}>
                Rene approves via{" "}
                <Code>POST /api/ops/fulfillment/freight-comp-queue</Code>
              </Muted>
            </>
          )}
        </Card>

        {/* ---- Stale voids ---- */}
        <Card title="Stale ShipStation Voids">
          {!data && <Muted>Loading…</Muted>}
          {data && data.staleVoids.unavailableReason && (
            <Muted>Unavailable: {data.staleVoids.unavailableReason}</Muted>
          )}
          {data && !data.staleVoids.unavailableReason && (
            <>
              <Row>
                <Label>Count</Label>
                <Value
                  color={data.staleVoids.count > 0 ? RED : GREEN}
                  strong={data.staleVoids.count > 0}
                >
                  {data.staleVoids.count}
                </Value>
              </Row>
              <Row>
                <Label>Pending refund</Label>
                <Value>{money(data.staleVoids.pendingDollars)}</Value>
              </Row>
              {data.staleVoids.oldestAgeHours !== null && (
                <Row>
                  <Label>Oldest</Label>
                  <Value color={DIM}>
                    {Math.round(data.staleVoids.oldestAgeHours)}h
                  </Value>
                </Row>
              )}
              <Muted style={{ marginTop: 10 }}>
                Detail:{" "}
                <Code>GET /api/ops/shipstation/voided-labels</Code>
              </Muted>
            </>
          )}
        </Card>
      </div>

      {/* Recent labels table */}
      {recent && recent.shipments.length > 0 && (
        <div
          style={{
            marginTop: 22,
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: 16,
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
              Recent labels (last 7 days)
            </div>
            <div style={{ fontSize: 12, color: DIM }}>
              {recent.totalCount} · active {money(recent.activeSpend)} · voided {money(recent.voidedSpend)}
            </div>
          </div>
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
                  <Th>Ship date</Th>
                  <Th>Carrier / Svc</Th>
                  <Th>Cost</Th>
                  <Th>Tracking</Th>
                  <Th>Ship-to</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {recent.shipments.slice(0, 25).map((s) => (
                  <tr
                    key={s.shipmentId}
                    style={{
                      borderTop: `1px dashed ${BORDER}`,
                      opacity: s.voided ? 0.55 : 1,
                    }}
                  >
                    <Td>
                      {s.shipDate?.slice(0, 10) ??
                        s.createDate?.slice(0, 10) ??
                        "—"}
                    </Td>
                    <Td>
                      <Code>
                        {s.carrierCode ?? "?"}
                        {s.serviceCode ? ` · ${s.serviceCode}` : ""}
                      </Code>
                    </Td>
                    <Td>
                      {s.shipmentCost !== null ? money(s.shipmentCost) : "—"}
                    </Td>
                    <Td>
                      {s.trackingNumber ? (
                        <Code>{s.trackingNumber}</Code>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>
                      {s.shipToName ?? "—"}
                      {s.shipToPostalCode ? ` · ${s.shipToPostalCode}` : ""}
                    </Td>
                    <Td>
                      {s.voided ? (
                        <span style={{ color: RED, fontWeight: 600 }}>
                          VOIDED
                        </span>
                      ) : (
                        <span style={{ color: GREEN, fontWeight: 600 }}>
                          ACTIVE
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
        Polls <Code>/api/ops/fulfillment/preflight</Code> every 30s. Wallet
        balances come from ShipStation <Code>/carriers</Code>. ATP sums
        on-hand from the cached Shopify inventory snapshot (refreshed daily
        at 10:00 PT by the Ops Agent, auto-decremented on every buy-label
        success) minus pending outbound in <Code>fulfillment:stages</Code>.
        Freight-comp queue is <Code>fulfillment:freight-comp-queue</Code>.
        Stale voids come from ShipStation <Code>/shipments?voided=true</Code>
        filtered to &gt;72h since void.
      </div>
    </div>
  );
}

// ---- Helper components --------------------------------------------------

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        background: CARD,
        padding: 16,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.8,
          color: GOLD,
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        padding: "6px 0",
        borderBottom: `1px dashed ${BORDER}`,
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

function Label({
  children,
  strong,
}: {
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <span
      style={{
        color: strong ? NAVY : DIM,
        fontWeight: strong ? 700 : 500,
      }}
    >
      {children}
    </span>
  );
}

function Value({
  children,
  color,
  strong,
}: {
  children: React.ReactNode;
  color?: string;
  strong?: boolean;
}) {
  return (
    <span
      style={{
        color: color ?? NAVY,
        fontFamily: "ui-monospace, Menlo, monospace",
        fontWeight: strong ? 700 : 500,
      }}
    >
      {children}
    </span>
  );
}

function TailLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{ fontSize: 11, marginLeft: 6, fontWeight: 400 }}
    >
      {children}
    </span>
  );
}

function Muted({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ fontSize: 12, color: DIM, fontStyle: "italic", ...style }}>
      {children}
    </div>
  );
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
  return (
    <td style={{ padding: "8px 8px", verticalAlign: "top" }}>{children}</td>
  );
}
