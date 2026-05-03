"use client";

/**
 * Pipeline Drift — operator dashboard for the evidence-graded pipeline.
 *
 * Pulls deals from HubSpot via the existing pipeline endpoint, then
 * for each deal compares the canonical-mapped HubSpot stage against
 * the verified evidence trail (KV-backed). Surfaces drift as a sortable
 * table with severity badges + click-through to evidence detail.
 *
 * Read-only — no HubSpot stage is moved from this page. Stage advances
 * happen via the dedicated `hubspot.deal.stage.move` Class C approval.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  NAVY,
  RED,
  GOLD,
  CREAM as BG,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";

interface DriftRow {
  dealId: string;
  dealName?: string;
  hubspotStage: string;
  verifiedStage: string | null;
  driftSteps: number;
  missingEvidenceForStages: string[];
  reason: string;
  verification: string;
}

interface DriftResponse {
  ok: boolean;
  generatedAt: string;
  summary: {
    total: number;
    clean: number;
    driftCount: number;
    bySeverity: {
      oneStep: number;
      twoStep: number;
      threePlusStep: number;
      noEvidence: number;
    };
  };
  drifted: DriftRow[];
  verified: Array<{
    dealId: string;
    dealName?: string;
    verifiedStage: string | null;
    verification: string;
  }>;
  degraded: string[];
}

interface HubspotDeal {
  id: string;
  dealname: string;
  dealstage: string;
}

const STAGE_LABELS: Record<string, string> = {
  interested: "Interested",
  sample_requested: "Sample Requested",
  sample_shipped: "Sample Shipped",
  sample_delivered: "Sample Delivered",
  vendor_setup: "Vendor Setup",
  quote_sent: "Quote Sent",
  po_received: "PO / Order Received",
  invoice_sent: "Invoice Sent",
  paid: "Paid",
  shipped: "Shipped",
  reorder_due: "Reorder Due",
  reordered: "Reordered",
};

const HUBSPOT_TO_CANONICAL: Record<string, string> = {
  appointmentscheduled: "interested",
  "3017718463": "sample_requested",
  "3017718464": "sample_shipped",
  "3017718465": "quote_sent",
  "3502336729": "vendor_setup",
  "3017718466": "po_received",
  "3017718460": "shipped",
  "3485080311": "reordered",
  "3502336730": "paid",
};

export function PipelineDriftView() {
  const [data, setData] = useState<DriftResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterSeverity, setFilterSeverity] = useState<
    "all" | "one" | "two" | "three" | "noev"
  >("all");

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      // 1. Fetch deals from HubSpot (existing read-only endpoint).
      const dealsRes = await fetch("/api/ops/hubspot/proactive", {
        cache: "no-store",
      });
      if (!dealsRes.ok) {
        throw new Error(`Failed to fetch HubSpot deals: ${dealsRes.status}`);
      }
      // Best-effort: that endpoint may return a richer shape; fall back
      // to /api/ops/sales for a simpler list.
      let deals: HubspotDeal[] = [];
      try {
        const dealsBody = (await dealsRes.json()) as {
          deals?: HubspotDeal[];
        };
        deals = Array.isArray(dealsBody.deals) ? dealsBody.deals : [];
      } catch {
        deals = [];
      }
      if (deals.length === 0) {
        // Fall back to /api/ops/sales/recent-deals if available
        try {
          const fallback = await fetch("/api/ops/sales/recent-deals", {
            cache: "no-store",
          });
          if (fallback.ok) {
            const body = (await fallback.json()) as { deals?: HubspotDeal[] };
            if (Array.isArray(body.deals)) deals = body.deals;
          }
        } catch {
          /* swallow — empty deals shows the empty state */
        }
      }

      // 2. Map to canonical claims + POST drift.
      const dealClaims = deals
        .map((d) => ({
          dealId: d.id,
          dealName: d.dealname,
          hubspotStage: HUBSPOT_TO_CANONICAL[d.dealstage] ?? null,
        }))
        .filter(
          (d): d is {
            dealId: string;
            dealName: string;
            hubspotStage: string;
          } => Boolean(d.hubspotStage),
        );

      if (dealClaims.length === 0) {
        setData({
          ok: true,
          generatedAt: new Date().toISOString(),
          summary: {
            total: 0,
            clean: 0,
            driftCount: 0,
            bySeverity: {
              oneStep: 0,
              twoStep: 0,
              threePlusStep: 0,
              noEvidence: 0,
            },
          },
          drifted: [],
          verified: [],
          degraded: ["no-deals-from-hubspot"],
        });
        return;
      }

      const driftRes = await fetch("/api/ops/sales/pipeline-drift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deals: dealClaims }),
      });
      if (!driftRes.ok) {
        throw new Error(`Drift API: ${driftRes.status}`);
      }
      const body = (await driftRes.json()) as DriftResponse;
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleRows = useMemo(() => {
    if (!data) return [];
    let rows = [...data.drifted];
    if (filterSeverity === "one") {
      rows = rows.filter((r) => r.driftSteps === 1);
    } else if (filterSeverity === "two") {
      rows = rows.filter((r) => r.driftSteps === 2);
    } else if (filterSeverity === "three") {
      rows = rows.filter((r) => r.driftSteps >= 3 && r.verifiedStage !== null);
    } else if (filterSeverity === "noev") {
      rows = rows.filter((r) => r.verifiedStage === null);
    }
    return rows.sort((a, b) => {
      // No-evidence first, then driftSteps desc
      if ((a.verifiedStage === null) !== (b.verifiedStage === null)) {
        return a.verifiedStage === null ? -1 : 1;
      }
      return b.driftSteps - a.driftSteps;
    });
  }, [data, filterSeverity]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: BG,
        color: NAVY,
        padding: "32px clamp(16px, 4vw, 48px)",
      }}
    >
      <section style={{ maxWidth: 1200, margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 20,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: "clamp(28px, 4vw, 44px)" }}>
              🧭 Pipeline drift
            </h1>
            <p style={{ margin: "10px 0 0", color: DIM, maxWidth: 760 }}>
              Deals where the HubSpot stage runs ahead of the verified
              evidence trail. <strong>HubSpot stage alone is not
              evidence.</strong> Read-only — no HubSpot stage is moved from
              this page. Promotion happens via the canonical{" "}
              <code style={code}>hubspot.deal.stage.move</code> Class C
              approval, which now consumes the evidence trail.
            </p>
          </div>
          <button onClick={() => void load()} disabled={loading} style={btn}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </header>

        {error && <Banner tone="red">❌ {error}</Banner>}
        {data && data.degraded.length > 0 && (
          <Banner tone="yellow">
            ⚠️ Degraded: {data.degraded.slice(0, 3).join(" · ")}
          </Banner>
        )}

        {data && (
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 18,
            }}
          >
            <Chip
              label="All"
              count={data.summary.total}
              active={filterSeverity === "all"}
              onClick={() => setFilterSeverity("all")}
            />
            <Chip
              label="🟢 Clean"
              count={data.summary.clean}
              color={GREEN}
              active={false}
            />
            <Chip
              label="1 step ahead"
              count={data.summary.bySeverity.oneStep}
              color={YELLOW}
              active={filterSeverity === "one"}
              onClick={() => setFilterSeverity("one")}
            />
            <Chip
              label="2 steps"
              count={data.summary.bySeverity.twoStep}
              color={YELLOW}
              active={filterSeverity === "two"}
              onClick={() => setFilterSeverity("two")}
            />
            <Chip
              label="3+ steps"
              count={data.summary.bySeverity.threePlusStep}
              color={RED}
              active={filterSeverity === "three"}
              onClick={() => setFilterSeverity("three")}
            />
            <Chip
              label="No evidence"
              count={data.summary.bySeverity.noEvidence}
              color={RED}
              active={filterSeverity === "noev"}
              onClick={() => setFilterSeverity("noev")}
            />
          </div>
        )}

        {data && visibleRows.length === 0 && data.summary.driftCount === 0 && (
          <div
            style={{
              ...sectionStyle,
              textAlign: "center",
              padding: "32px 16px",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700, color: GREEN }}>
              🟢 All clean
            </div>
            <div style={{ color: DIM, marginTop: 8, fontSize: 13 }}>
              Every HubSpot stage matches the verified evidence trail.
            </div>
          </div>
        )}

        {data && visibleRows.length === 0 && data.summary.driftCount > 0 && (
          <div
            style={{
              ...sectionStyle,
              textAlign: "center",
              padding: "32px 16px",
              color: DIM,
              fontSize: 13,
            }}
          >
            No rows match the current filter.
          </div>
        )}

        {data && visibleRows.length > 0 && (
          <div style={sectionStyle}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead>
                <tr style={{ textAlign: "left", color: DIM }}>
                  <th style={th}>Deal</th>
                  <th style={th}>HubSpot says</th>
                  <th style={th}>Verified</th>
                  <th style={th}>Drift</th>
                  <th style={th}>Missing evidence</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr
                    key={r.dealId}
                    style={{
                      borderBottom: `1px solid ${BORDER}`,
                      verticalAlign: "top",
                    }}
                  >
                    <td style={td}>
                      <div style={{ fontWeight: 700 }}>
                        {r.dealName ?? r.dealId}
                      </div>
                      <a
                        href={`/api/ops/sales/pipeline-evidence/${encodeURIComponent(r.dealId)}`}
                        style={{
                          fontSize: 11,
                          color: DIM,
                          textDecoration: "none",
                          fontFamily: "ui-monospace, Menlo, monospace",
                        }}
                      >
                        {r.dealId}
                      </a>
                    </td>
                    <td style={td}>
                      <code style={code}>
                        {STAGE_LABELS[r.hubspotStage] ?? r.hubspotStage}
                      </code>
                    </td>
                    <td style={td}>
                      {r.verifiedStage ? (
                        <span>{STAGE_LABELS[r.verifiedStage] ?? r.verifiedStage}</span>
                      ) : (
                        <span style={{ color: RED, fontWeight: 700 }}>
                          (no evidence)
                        </span>
                      )}
                    </td>
                    <td style={td}>
                      <DriftBadge
                        steps={r.driftSteps}
                        noEvidence={r.verifiedStage === null}
                      />
                    </td>
                    <td style={td}>
                      <div
                        style={{
                          color: DIM,
                          fontSize: 12,
                          fontFamily: "ui-monospace, Menlo, monospace",
                        }}
                      >
                        {r.missingEvidenceForStages
                          .slice(0, 3)
                          .map((s) => STAGE_LABELS[s] ?? s)
                          .join(", ")}
                        {r.missingEvidenceForStages.length > 3
                          ? ` (+${r.missingEvidenceForStages.length - 3} more)`
                          : ""}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div
          style={{
            marginTop: 22,
            padding: "12px 14px",
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            fontSize: 12,
            color: DIM,
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 600, color: NAVY, marginBottom: 4 }}>
            How drift is computed
          </div>
          For each HubSpot deal, the API maps the dealstage to a canonical
          stage (interested → … → reordered) then compares it to the
          highest stage S where ≥ 1 evidence row matches{" "}
          <code style={code}>EVIDENCE_TYPES_BY_STAGE[S]</code>. Drift =
          HubSpot stage index − verified stage index. Read-only across the
          board: this page never moves a HubSpot stage. To advance a
          stage with evidence, route through the canonical{" "}
          <code style={code}>hubspot.deal.stage.move</code> Class C
          approval.
        </div>
      </section>
    </main>
  );
}

const GREEN = "#16a34a";
const YELLOW = "#eab308";

const sectionStyle: React.CSSProperties = {
  background: CARD,
  border: `1px solid ${BORDER}`,
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
};

const btn: React.CSSProperties = {
  border: `1px solid ${BORDER}`,
  background: CARD,
  color: NAVY,
  borderRadius: 999,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

const th: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  padding: "8px 10px",
  borderBottom: `1px solid ${BORDER}`,
};

const td: React.CSSProperties = {
  padding: "10px",
};

const code: React.CSSProperties = {
  fontFamily: "ui-monospace, Menlo, monospace",
  background: "rgba(27,42,74,0.04)",
  padding: "1px 6px",
  borderRadius: 4,
  fontSize: 11,
};

function Chip({
  label,
  count,
  color,
  active,
  onClick,
}: {
  label: string;
  count: number;
  color?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const c = color ?? NAVY;
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      style={{
        border: `1px solid ${active ? c : `${c}44`}`,
        background: active ? `${c}1f` : `${c}0d`,
        color: c,
        padding: "5px 12px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        cursor: onClick ? "pointer" : "default",
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      {label} · {count}
    </button>
  );
}

function DriftBadge({ steps, noEvidence }: { steps: number; noEvidence: boolean }) {
  if (noEvidence) {
    return (
      <span
        style={{
          padding: "3px 9px",
          borderRadius: 999,
          background: `${RED}1f`,
          color: RED,
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        🚨 no-evidence
      </span>
    );
  }
  const color = steps >= 3 ? RED : steps === 2 ? YELLOW : GOLD;
  return (
    <span
      style={{
        padding: "3px 9px",
        borderRadius: 999,
        background: `${color}1f`,
        color,
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      +{steps}
    </span>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "red" | "yellow";
  children: React.ReactNode;
}) {
  const c = tone === "red" ? RED : YELLOW;
  return (
    <div
      style={{
        border: `1px solid ${c}55`,
        background: `${c}0d`,
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 16,
        fontSize: 13,
        color: tone === "red" ? RED : NAVY,
      }}
    >
      {children}
    </div>
  );
}
