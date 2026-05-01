"use client";

import type React from "react";
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
  formatPercentRange,
  formatUsdRange,
  formatUsdValue,
  labelForAlert,
  sortCommittedVendorsForReview,
  summarizeVendorMarginLedger,
  toneForAlert,
} from "./data";

import type {
  ChannelMarginRow,
  CommittedVendorMargin,
  MarginAlert,
  PendingVendorMargin,
  PerVendorMarginLedger,
} from "@/lib/finance/per-vendor-margin";

interface VendorMarginResponse {
  ok?: boolean;
  generatedAt?: string;
  source?: {
    path?: string;
    status?: string | null;
    version?: string | null;
  };
  counts?: {
    committedVendors: number;
    channelRows: number;
    pendingVendors: number;
  };
  ledger?: PerVendorMarginLedger;
  error?: string;
  code?: string;
}

type LoadState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: VendorMarginResponse; error: null }
  | { status: "error"; data: null; error: string };

const TONE_COLORS: Record<ReturnType<typeof toneForAlert>, string> = {
  red: RED,
  amber: GOLD,
  blue: NAVY,
  green: "#1f7a3a",
};

async function fetchVendorMargin(): Promise<LoadState> {
  try {
    const res = await fetch("/api/ops/finance/vendor-margin", {
      method: "GET",
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as
      | VendorMarginResponse
      | null;
    if (!res.ok || !body || body.ok !== true) {
      return {
        status: "error",
        data: null,
        error:
          body?.error ??
          body?.code ??
          `HTTP ${res.status} ${res.statusText}`,
      };
    }
    return { status: "ready", data: body, error: null };
  } catch (err) {
    return {
      status: "error",
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function VendorMarginView() {
  const [state, setState] = useState<LoadState>({
    status: "loading",
    data: null,
    error: null,
  });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", data: null, error: null });
    void fetchVendorMargin().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const ledger = state.status === "ready" ? state.data.ledger : null;
  const summary = useMemo(
    () => summarizeVendorMarginLedger(ledger),
    [ledger],
  );
  const sortedVendors = useMemo(
    () => sortCommittedVendorsForReview(ledger?.committedVendors),
    [ledger],
  );

  return (
    <main
      style={{
        minHeight: "100vh",
        background: BG,
        color: NAVY,
        padding: "32px clamp(16px, 4vw, 48px)",
      }}
    >
      <section style={{ maxWidth: 1320, margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            alignItems: "flex-start",
            marginBottom: 24,
            flexWrap: "wrap",
          }}
        >
          <div>
            <p
              style={{
                margin: "0 0 8px",
                color: DIM,
                textTransform: "uppercase",
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: "0.08em",
              }}
            >
              Finance · Read-only
            </p>
            <h1 style={{ margin: 0, fontSize: "clamp(32px, 4vw, 52px)" }}>
              Vendor margin ledger
            </h1>
            <p style={{ margin: "12px 0 0", color: DIM, maxWidth: 760 }}>
              Sourced from <code>contracts/per-vendor-margin-ledger.md</code>.
              This page surfaces below-floor, thin, and missing-actual rows
              without writing to QBO, HubSpot, Shopify, pricing, or invoices.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRefreshKey((n) => n + 1)}
            style={{
              border: `1px solid ${BORDER}`,
              background: CARD,
              color: NAVY,
              borderRadius: 999,
              padding: "10px 14px",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
        </header>

        {state.status === "loading" ? (
          <Panel>Loading vendor margin ledger...</Panel>
        ) : null}

        {state.status === "error" ? (
          <Panel>
            <strong style={{ color: RED }}>Unable to load ledger.</strong>
            <div style={{ marginTop: 6, color: DIM }}>{state.error}</div>
          </Panel>
        ) : null}

        {state.status === "ready" && ledger ? (
          <>
            <SourceBand response={state.data} />
            <SummaryGrid summary={summary} />
            <VendorTable vendors={sortedVendors} />
            <ChannelRows rows={ledger.channelRows} />
            <PendingRows rows={ledger.pendingVendors} />
          </>
        ) : null}
      </section>
    </main>
  );
}

function SourceBand({ response }: { response: VendorMarginResponse }) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 18,
        padding: 16,
        display: "grid",
        gap: 10,
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        marginBottom: 16,
      }}
    >
      <Meta label="Source" value={response.source?.path ?? "Unknown"} />
      <Meta label="Ledger status" value={response.source?.status ?? "TBD"} />
      <Meta label="Version" value={response.source?.version ?? "TBD"} />
      <Meta label="Generated" value={formatTimestamp(response.generatedAt)} />
    </div>
  );
}

function SummaryGrid({
  summary,
}: {
  summary: ReturnType<typeof summarizeVendorMarginLedger>;
}) {
  return (
    <div
      style={{
        display: "grid",
        gap: 12,
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        marginBottom: 18,
      }}
    >
      <Stat label="Committed" value={summary.totalCommitted} />
      <Stat label="Below floor" value={summary.belowFloor} color={RED} />
      <Stat label="Thin" value={summary.thin} color={GOLD} />
      <Stat label="Needs actuals" value={summary.unknown} color={NAVY} />
      <Stat label="Healthy" value={summary.healthy} color="#1f7a3a" />
      <Stat label="Pending" value={summary.totalPending} />
    </div>
  );
}

function VendorTable({ vendors }: { vendors: CommittedVendorMargin[] }) {
  return (
    <section style={sectionStyle}>
      <SectionHeader
        title="Committed vendor rows"
        description="Sorted by risk first, then lowest gross profit per bag. TBD means the ledger does not contain a sourced actual."
      />
      {vendors.length === 0 ? (
        <Empty>No committed vendor rows in the ledger.</Empty>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>Vendor</Th>
                <Th>Alert</Th>
                <Th>Price</Th>
                <Th>COGS</Th>
                <Th>Freight</Th>
                <Th>GP / bag</Th>
                <Th>GP %</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((vendor) => (
                <tr key={vendor.slug}>
                  <Td strong>{vendor.name}</Td>
                  <Td>
                    <AlertPill alert={vendor.marginAlert} />
                  </Td>
                  <Td>{formatUsdValue(vendor.pricePerBagUsd)}</Td>
                  <Td>{formatUsdValue(vendor.operatingCogsUsd)}</Td>
                  <Td>{formatUsdRange(vendor.freightPerBagUsd)}</Td>
                  <Td>{formatUsdRange(vendor.gpPerBagUsd)}</Td>
                  <Td>{formatPercentRange(vendor.gpPct)}</Td>
                  <Td>{vendor.statusLabel ?? "TBD"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ChannelRows({ rows }: { rows: ChannelMarginRow[] }) {
  return (
    <section style={sectionStyle}>
      <SectionHeader
        title="Channel margin rows"
        description="Context rows from the same ledger. They are not vendor commitments."
      />
      {rows.length === 0 ? (
        <Empty>No channel rows in the ledger.</Empty>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>Channel</Th>
                <Th>Alert</Th>
                <Th>Price / bag</Th>
                <Th>Effective COGS</Th>
                <Th>Freight</Th>
                <Th>GP / bag</Th>
                <Th>GP %</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.channel}>
                  <Td strong>{row.channel}</Td>
                  <Td>
                    <AlertPill alert={row.marginAlert} />
                  </Td>
                  <Td>{row.pricePerBag || "TBD"}</Td>
                  <Td>{row.effectiveCogs || "TBD"}</Td>
                  <Td>{row.freight || "TBD"}</Td>
                  <Td>{row.gpPerBag || "TBD"}</Td>
                  <Td>{row.gpPct || "TBD"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PendingRows({ rows }: { rows: PendingVendorMargin[] }) {
  return (
    <section style={sectionStyle}>
      <SectionHeader
        title="Pending vendors"
        description="Pipeline context only. These rows do not move deal stages or create finance records."
      />
      {rows.length === 0 ? (
        <Empty>No pending vendor rows in the ledger.</Empty>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((row) => (
            <div
              key={`${row.vendor}-${row.hubSpotDeal}`}
              style={{
                border: `1px solid ${BORDER}`,
                borderRadius: 14,
                padding: 14,
                background: "rgba(248,245,239,0.58)",
              }}
            >
              <div style={{ fontWeight: 900 }}>{row.vendor}</div>
              <div style={{ color: DIM, marginTop: 4 }}>
                {row.stage || "Stage TBD"} · last touch{" "}
                {row.lastTouch || "TBD"} · likely tier{" "}
                {row.likelyTierOnCommit || "TBD"}
              </div>
              <div style={{ color: DIM, marginTop: 4 }}>
                HubSpot deal: {row.hubSpotDeal || "TBD"}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AlertPill({ alert }: { alert: MarginAlert }) {
  const color = TONE_COLORS[toneForAlert(alert)];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        background: `${color}1A`,
        color,
        fontWeight: 900,
        fontSize: 12,
        padding: "5px 9px",
        whiteSpace: "nowrap",
      }}
    >
      {labelForAlert(alert)}
    </span>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 18,
        padding: 18,
      }}
    >
      {children}
    </div>
  );
}

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 22 }}>{title}</h2>
      <p style={{ margin: "6px 0 0", color: DIM }}>{description}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  color = NAVY,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        padding: 14,
      }}
    >
      <div style={{ color: DIM, fontSize: 12, fontWeight: 800 }}>{label}</div>
      <div style={{ color, fontSize: 32, fontWeight: 950, marginTop: 6 }}>
        {value}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: DIM, fontSize: 12, fontWeight: 800 }}>{label}</div>
      <div style={{ marginTop: 4, fontWeight: 800 }}>{value || "TBD"}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: `1px dashed ${BORDER}`,
        borderRadius: 14,
        padding: 16,
        color: DIM,
      }}
    >
      {children}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={thStyle}>{children}</th>;
}

function Td({
  children,
  strong = false,
}: {
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <td
      style={{
        padding: "12px 10px",
        borderTop: `1px solid ${BORDER}`,
        color: NAVY,
        fontWeight: strong ? 900 : 600,
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  );
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return "TBD";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

const sectionStyle: React.CSSProperties = {
  background: CARD,
  border: `1px solid ${BORDER}`,
  borderRadius: 18,
  padding: 18,
  marginTop: 16,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: 860,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0 10px 10px",
  color: DIM,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};
