"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  NAVY,
  RED,
  GOLD,
  CREAM as BG,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";

const GREEN = "#15803d";
const AMBER = "#b45309";

// ---------------------------------------------------------------------------
// Types — mirror the server-side report shape
// ---------------------------------------------------------------------------

type SourceState<T> =
  | { status: "wired"; value: T }
  | { status: "not_wired"; reason: string }
  | { status: "error"; reason: string };

interface FaireInviteCounts {
  needs_review: number;
  approved: number;
  sent: number;
  rejected: number;
  total: number;
}
interface FaireFollowUpCounts {
  overdue: number;
  due_soon: number;
  not_due: number;
  sent_total: number;
}
interface FaireFollowUpRowSummary {
  id: string;
  retailerName: string;
  email: string;
  daysSinceSent: number | null;
  bucket: "overdue" | "due_soon";
}
interface ApPacketCounts {
  total: number;
  ready_to_send: number;
  action_required: number;
  sent: number;
}
interface LocationDraftCounts {
  needs_review: number;
  accepted: number;
  rejected: number;
  total: number;
}
interface PendingApprovalSummary {
  total: number;
  byTargetType: Record<string, number>;
  preview: Array<{
    id: string;
    targetType: string;
    label: string | null;
    actionSlug: string;
    createdAt: string;
  }>;
}
interface SalesPipelineSummary {
  stages: Array<{ id: string; name: string; count: number }>;
  openDealCount: number;
  staleSampleShipped: {
    total: number;
    preview: Array<{
      id: string;
      dealname: string | null;
      lastModifiedAt: string | null;
    }>;
  };
  openCallTasks: {
    total: number;
    preview: Array<{
      id: string;
      subject: string | null;
      priority: string | null;
      dueAt: string | null;
    }>;
  };
}
interface StaleBuyerSummary {
  asOf: string;
  stalest: Array<{
    dealId: string;
    dealName: string;
    stageName: string;
    daysSinceActivity: number;
    thresholdDays: number;
    nextAction: string;
  }>;
  staleByStage: Array<{
    stageName: string;
    count: number;
    thresholdDays: number;
  }>;
  activeDealsScanned: number;
  source: { system: "hubspot"; retrievedAt: string };
}
interface HubSpotProactiveReport {
  generatedAt: string;
  status: "ready" | "error" | "not_wired";
  counts: {
    total: number;
    critical: number;
    watch: number;
    info: number;
    staleBuyers: number;
    staleSamples: number;
    openCallTasks: number;
  };
  topItems: Array<{
    id: string;
    kind: "stale_buyer" | "stale_sample" | "open_call_task";
    severity: "critical" | "watch" | "info";
    label: string;
    detail: string;
    nextAction: string;
    href: string;
    ageDays: number | null;
  }>;
  closingMachine: {
    mantra: string;
    counts: { hot: number; warm: number; cold: number; total: number };
    lanes: Array<{
      lane: string;
      label: string;
      dailyAction: string;
      count: number;
      topRows: Array<{
        id: string;
        label: string;
        href: string;
        temperature: "hot" | "warm" | "cold";
        blocker: string;
        nextMove: string;
        defaultCloseAsk: string;
      }>;
    }>;
  };
  notes: Array<{ source: string; state: "error" | "not_wired"; reason: string }>;
}

interface Report {
  generatedAt: string;
  todaysRevenueActions: {
    faireInvitesNeedsReview: number | null;
    faireFollowUpsActionable: number | null;
    pendingApprovals: number | null;
    retailDraftsNeedsReview: number | null;
    apPacketsActionRequired: number | null;
    staleBuyersNeedingFollowUp: number | null;
    anyAction: boolean;
  };
  faireDirect: {
    state: SourceState<FaireInviteCounts>;
    link: { href: string; label: string };
  };
  followUps: {
    state: SourceState<{
      counts: FaireFollowUpCounts;
      topActionable: FaireFollowUpRowSummary[];
    }>;
    link: { href: string; label: string };
  };
  wholesaleOnboarding: {
    inquiries: SourceState<{ total: number; lastSubmittedAt?: string }>;
    day1Prospects: SourceState<{
      total: number;
      emailReady: number;
      needsManualResearch: number;
      priorityA: number;
    }>;
    salesTour: SourceState<{
      total: number;
      warmOrHot: number;
      verifiedEmails: number;
      alreadySent: number;
      researchNeeded: number;
      callTasks: number;
    }>;
    pipeline: SourceState<SalesPipelineSummary>;
    staleBuyers: SourceState<StaleBuyerSummary>;
    apPackets: SourceState<ApPacketCounts>;
    links: Array<{ href: string; label: string }>;
  };
  hubSpotProactive: {
    state: SourceState<HubSpotProactiveReport>;
    link: { href: string; label: string };
  };
  retailProof: {
    state: SourceState<LocationDraftCounts>;
    link: { href: string; label: string };
  };
  awaitingBen: {
    state: SourceState<PendingApprovalSummary>;
    slackChannel: string;
  };
  aging: {
    topItems: Array<{
      source: string;
      id: string;
      label: string;
      link: string;
      anchorAt: string;
      ageHours: number;
      ageDays: number;
      tier: "fresh" | "watch" | "overdue" | "critical";
    }>;
    counts: {
      critical: number;
      overdue: number;
      watch: number;
      fresh: number;
      total: number;
    };
    missingTimestamps: Array<{
      source: string;
      id: string;
      label: string;
      link: string;
      reason: string;
    }>;
    link: { href: string; label: string };
  };
  kpiScorecard: {
    generatedAt: string;
    target: { usd: number; deadlineIso: string };
    daysRemaining: number;
    requiredDailyUsd: number;
    requiredWeeklyUsd: number;
    actualLast7dUsd: number | null;
    gapToWeeklyPaceUsd: number | null;
    confidence: "full" | "partial" | "none";
    channels: Array<{
      channel: "shopify" | "amazon" | "faire" | "b2b" | "unknown";
      status: "wired" | "not_wired" | "error";
      amountUsd: number | null;
      reason?: string;
    }>;
  };
  dispatchSummary: {
    openCount:
      | { status: "wired"; value: number }
      | { status: "not_wired" | "error"; reason: string };
    dispatchedLast24h:
      | { status: "wired"; value: number }
      | { status: "not_wired" | "error"; reason: string };
    oldestOpenShipDate: string | null;
    deepLink: string;
  };
  blockers: {
    missingEnv: string[];
    notes: Array<{
      source: string;
      state: "not_wired" | "error";
      reason: string;
    }>;
    link: { href: string; label: string };
  };
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function SalesCommandCenterView() {
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/ops/sales", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as
          | { ok: boolean; report: Report }
          | { error?: string };
        if (cancelled) return;
        if (
          !res.ok ||
          (body as { ok: boolean }).ok !== true ||
          !(body as { report?: Report }).report
        ) {
          setError(
            (body as { error?: string }).error ?? `HTTP ${res.status}`,
          );
          setData(null);
        } else {
          setData((body as { ok: boolean; report: Report }).report);
          setError(null);
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return (
    <div style={{ background: BG, minHeight: "100vh", padding: "24px 28px" }}>
      <header style={{ marginBottom: 18 }}>
        <div
          style={{
            fontSize: 13,
            color: DIM,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          Internal · Sales command center
        </div>
        <h1 style={{ color: NAVY, fontSize: 26, margin: "4px 0 0 0" }}>
          Sales — today&apos;s revenue actions
        </h1>
        <p style={{ color: DIM, fontSize: 13, marginTop: 4 }}>
          Read-only roll-up of Faire Direct, follow-ups, AP packets,
          retail proof drafts, and pending Slack approvals. <strong>No
          actions are taken from this page</strong> — links route to the
          existing workflow surfaces. Sources without a list endpoint show{" "}
          <em>not wired</em>.
        </p>
        <div style={{ marginTop: 6, fontSize: 11, color: DIM }}>
          {data ? (
            <>
              Generated {data.generatedAt.slice(0, 19).replace("T", " ")} UTC ·{" "}
              <button
                onClick={() => setTick((n) => n + 1)}
                style={{
                  background: "transparent",
                  color: NAVY,
                  border: 0,
                  textDecoration: "underline",
                  cursor: "pointer",
                  padding: 0,
                  font: "inherit",
                }}
              >
                refresh
              </button>
            </>
          ) : (
            "Loading…"
          )}
        </div>
      </header>

      {error && (
        <ErrorBanner>Sales command center fetch error: {error}</ErrorBanner>
      )}
      {loading && !data && (
        <div style={{ color: DIM, fontSize: 13 }}>Loading…</div>
      )}

      {data && (
        <>
          <TodaysActions report={data} />
          <FaireDirectSection report={data} />
          <FollowUpsSection report={data} />
          <WholesaleOnboardingSection report={data} />
          <HubSpotProactiveSection report={data} />
          <RetailProofSection report={data} />
          <AwaitingBenSection report={data} />
          <KpiScorecardSection report={data} />
          <DispatchSummarySection report={data} />
          <AgingSection report={data} />
          <BlockersSection report={data} />
        </>
      )}

      <p style={{ fontSize: 11, color: DIM, marginTop: 22 }}>
        Phase 1: this dashboard does not mutate. No email send, no
        approval open, no HubSpot write, no label buy. To act on a row,
        click through to the dedicated surface and use its existing
        approval gate.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function TodaysActions({ report }: { report: Report }) {
  const r = report.todaysRevenueActions;
  return (
    <Section title="Today's revenue actions">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        <Stat
          label="Faire invites awaiting review"
          value={r.faireInvitesNeedsReview}
          highlightColor={AMBER}
          actionable={(r.faireInvitesNeedsReview ?? 0) > 0}
          href="/ops/faire-direct"
        />
        <Stat
          label="Faire follow-ups due/overdue"
          value={r.faireFollowUpsActionable}
          highlightColor={RED}
          actionable={(r.faireFollowUpsActionable ?? 0) > 0}
          href="/ops/faire-direct"
        />
        <Stat
          label="Slack approvals awaiting Ben"
          value={r.pendingApprovals}
          highlightColor={GOLD}
          actionable={(r.pendingApprovals ?? 0) > 0}
        />
        <Stat
          label="AP packets action-required"
          value={r.apPacketsActionRequired}
          highlightColor={AMBER}
          actionable={(r.apPacketsActionRequired ?? 0) > 0}
          href="/ops/ap-packets"
        />
        <Stat
          label="Stale B2B buyers"
          value={r.staleBuyersNeedingFollowUp}
          highlightColor={RED}
          actionable={(r.staleBuyersNeedingFollowUp ?? 0) > 0}
          href="/api/ops/sales/stale-buyers"
        />
        <Stat
          label="Retail drafts to review"
          value={r.retailDraftsNeedsReview}
          highlightColor={AMBER}
          actionable={(r.retailDraftsNeedsReview ?? 0) > 0}
          href="/ops/locations"
        />
      </div>
      {!r.anyAction && (
        <p style={{ color: GREEN, fontSize: 12, marginTop: 10 }}>
          Nothing demands action right now across the wired sources.
        </p>
      )}
    </Section>
  );
}

function FaireDirectSection({ report }: { report: Report }) {
  const s = report.faireDirect.state;
  return (
    <Section title="Faire Direct" link={report.faireDirect.link}>
      {renderSourceState(s, (counts) => (
        <div style={{ display: "flex", gap: 18, fontSize: 13 }}>
          <span>
            Total: <strong>{counts.total}</strong>
          </span>
          <span style={{ color: AMBER }}>
            Needs review: <strong>{counts.needs_review}</strong>
          </span>
          <span style={{ color: GREEN }}>
            Approved: <strong>{counts.approved}</strong>
          </span>
          <span style={{ color: NAVY }}>
            Sent: <strong>{counts.sent}</strong>
          </span>
          <span style={{ color: RED }}>
            Rejected: <strong>{counts.rejected}</strong>
          </span>
        </div>
      ))}
    </Section>
  );
}

function FollowUpsSection({ report }: { report: Report }) {
  const s = report.followUps.state;
  return (
    <Section
      title="Follow-ups awaiting Ben"
      link={report.followUps.link}
    >
      {renderSourceState(s, ({ counts, topActionable }) => (
        <>
          <div
            style={{
              display: "flex",
              gap: 18,
              fontSize: 13,
              marginBottom: 8,
            }}
          >
            <span style={{ color: RED }}>
              Overdue (≥7 days): <strong>{counts.overdue}</strong>
            </span>
            <span style={{ color: AMBER }}>
              Due soon (3–6 days): <strong>{counts.due_soon}</strong>
            </span>
            <span style={{ color: DIM }}>
              Sent total: <strong>{counts.sent_total}</strong>
            </span>
          </div>
          {topActionable.length === 0 ? (
            <div style={{ fontSize: 12, color: DIM }}>
              (no follow-ups due or overdue)
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {topActionable.map((row) => (
                <li
                  key={row.id}
                  style={{
                    borderTop: `1px dashed ${BORDER}`,
                    padding: "6px 4px",
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12,
                  }}
                >
                  <span>
                    <strong>{row.retailerName}</strong> ·{" "}
                    <code>{row.email}</code>
                  </span>
                  <span
                    style={{
                      color: row.bucket === "overdue" ? RED : AMBER,
                    }}
                  >
                    {row.daysSinceSent ?? "?"}d ·{" "}
                    {row.bucket === "overdue" ? "OVERDUE" : "due soon"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ))}
    </Section>
  );
}

function WholesaleOnboardingSection({ report }: { report: Report }) {
  return (
    <Section title="Wholesale / B2B onboarding">
      <div style={{ marginBottom: 8 }}>
        <SubLabel>Wholesale inquiries</SubLabel>
        {renderSourceState(report.wholesaleOnboarding.inquiries, (v) => (
          <div style={{ fontSize: 13 }}>
            Total tracked: <strong>{v.total}</strong>
            {v.lastSubmittedAt ? (
              <span style={{ color: DIM, marginLeft: 8 }}>
                last {v.lastSubmittedAt.slice(0, 10)}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <div style={{ marginBottom: 8 }}>
        <SubLabel>Day 1 prospect playbook</SubLabel>
        {renderSourceState(report.wholesaleOnboarding.day1Prospects, (v) => (
          <div style={{ display: "flex", gap: 16, fontSize: 13, flexWrap: "wrap" }}>
            <span>
              Total: <strong>{v.total}</strong>
            </span>
            <span style={{ color: GREEN }}>
              Email-ready: <strong>{v.emailReady}</strong>
            </span>
            <span style={{ color: AMBER }}>
              Manual research: <strong>{v.needsManualResearch}</strong>
            </span>
            <span style={{ color: GOLD }}>
              Priority A: <strong>{v.priorityA}</strong>
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginBottom: 8 }}>
        <SubLabel>May sales tour</SubLabel>
        {renderSourceState(report.wholesaleOnboarding.salesTour, (v) => (
          <div style={{ display: "flex", gap: 16, fontSize: 13, flexWrap: "wrap" }}>
            <span>
              Total: <strong>{v.total}</strong>
            </span>
            <span style={{ color: GOLD }}>
              Warm / hot: <strong>{v.warmOrHot}</strong>
            </span>
            <span style={{ color: GREEN }}>
              Verified: <strong>{v.verifiedEmails}</strong>
            </span>
            <span style={{ color: GREEN }}>
              Sent: <strong>{v.alreadySent}</strong>
            </span>
            <span style={{ color: AMBER }}>
              Research: <strong>{v.researchNeeded}</strong>
            </span>
            <span style={{ color: AMBER }}>
              Calls: <strong>{v.callTasks}</strong>
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginBottom: 8 }}>
        <SubLabel>HubSpot B2B pipeline</SubLabel>
        {renderSourceState(report.wholesaleOnboarding.pipeline, (v) => (
          <>
            <div style={{ display: "flex", gap: 16, fontSize: 13, flexWrap: "wrap" }}>
              <span>
                Open deals: <strong>{v.openDealCount}</strong>
              </span>
              <span style={{ color: RED }}>
                Stale samples: <strong>{v.staleSampleShipped.total}</strong>
              </span>
              <span style={{ color: AMBER }}>
                Call tasks: <strong>{v.openCallTasks.total}</strong>
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 6,
                marginTop: 8,
              }}
            >
              {v.stages
                .filter((s) => s.count > 0)
                .map((s) => (
                  <div
                    key={s.id}
                    style={{
                      background: "#fff",
                      border: `1px solid ${BORDER}`,
                      borderRadius: 6,
                      padding: "6px 8px",
                      fontSize: 12,
                    }}
                  >
                    <strong>{s.count}</strong>{" "}
                    <span style={{ color: DIM }}>{s.name}</span>
                  </div>
                ))}
            </div>
            {v.staleSampleShipped.preview.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0 0" }}>
                {v.staleSampleShipped.preview.slice(0, 3).map((d) => (
                  <li
                    key={d.id}
                    style={{
                      borderTop: `1px dashed ${BORDER}`,
                      padding: "5px 4px",
                      fontSize: 12,
                      color: DIM,
                    }}
                  >
                    Sample follow-up: <strong>{d.dealname ?? d.id}</strong>
                    {d.lastModifiedAt ? ` · ${d.lastModifiedAt.slice(0, 10)}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </>
        ))}
      </div>
      <div style={{ marginBottom: 8 }}>
        <SubLabel>Stale buyer hit list</SubLabel>
        {renderSourceState(report.wholesaleOnboarding.staleBuyers, (v) => {
          const totalStale = v.staleByStage.reduce(
            (sum, row) => sum + row.count,
            0,
          );
          return (
            <>
              <div style={{ display: "flex", gap: 16, fontSize: 13, flexWrap: "wrap" }}>
                <span>
                  Stale: <strong>{totalStale}</strong>
                </span>
                <span style={{ color: DIM }}>
                  Scanned: <strong>{v.activeDealsScanned}</strong>
                </span>
                <span style={{ color: DIM }}>
                  Source: HubSpot · {v.source.retrievedAt.slice(0, 10)}
                </span>
              </div>
              {v.stalest.length > 0 ? (
                <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0 0" }}>
                  {v.stalest.slice(0, 5).map((d) => (
                    <li
                      key={d.dealId}
                      style={{
                        borderTop: `1px dashed ${BORDER}`,
                        padding: "5px 4px",
                        fontSize: 12,
                      }}
                    >
                      <strong>{d.dealName}</strong>
                      <span style={{ color: DIM, marginLeft: 8 }}>
                        {d.stageName} · {Number.isFinite(d.daysSinceActivity) ? `${d.daysSinceActivity}d` : "no activity timestamp"} · {d.nextAction}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div style={{ fontSize: 12, color: DIM }}>
                  (no stale B2B buyers)
                </div>
              )}
            </>
          );
        })}
      </div>
      <div>
        <SubLabel>AP packets</SubLabel>
        {renderSourceState(report.wholesaleOnboarding.apPackets, (counts) => (
          <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
            <span>
              Total: <strong>{counts.total}</strong>
            </span>
            <span style={{ color: AMBER }}>
              Action required: <strong>{counts.action_required}</strong>
            </span>
            <span style={{ color: GREEN }}>
              Ready to send: <strong>{counts.ready_to_send}</strong>
            </span>
            <span style={{ color: NAVY }}>
              Sent: <strong>{counts.sent}</strong>
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 12 }}>
        {report.wholesaleOnboarding.links.map((l) => (
          <Link key={l.href} href={l.href} style={linkStyle}>
            {l.label} →
          </Link>
        ))}
      </div>
    </Section>
  );
}

function HubSpotProactiveSection({ report }: { report: Report }) {
  return (
    <Section
      title="HubSpot proactive queue"
      link={report.hubSpotProactive.link}
    >
      {renderSourceState(report.hubSpotProactive.state, (v) => (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
            <MiniStat label="Total" value={v.counts.total} />
            <MiniStat label="Hot" value={v.closingMachine.counts.hot} color={RED} />
            <MiniStat label="Warm" value={v.closingMachine.counts.warm} color={AMBER} />
            <MiniStat label="Critical" value={v.counts.critical} color={RED} />
            <MiniStat label="Watch" value={v.counts.watch} color={AMBER} />
            <MiniStat label="Call tasks" value={v.counts.openCallTasks} color={NAVY} />
          </div>
          <div
            style={{
              background: `${GOLD}12`,
              border: `1px solid ${GOLD}35`,
              borderRadius: 8,
              padding: "9px 10px",
              color: NAVY,
              fontSize: 12,
              marginBottom: 10,
            }}
          >
            <strong>May closing mantra:</strong> {v.closingMachine.mantra}
          </div>
          {v.closingMachine.lanes.length > 0 ? (
            <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
              {v.closingMachine.lanes.slice(0, 5).map((lane) => (
                <div
                  key={lane.lane}
                  style={{
                    border: `1px solid ${BORDER}`,
                    borderRadius: 8,
                    padding: "9px 10px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      color: NAVY,
                      fontSize: 13,
                      fontWeight: 800,
                    }}
                  >
                    <span>{lane.label}</span>
                    <span>{lane.count}</span>
                  </div>
                  <div style={{ color: DIM, fontSize: 12, marginTop: 2 }}>
                    {lane.dailyAction}
                  </div>
                  {lane.topRows.slice(0, 2).map((row) => (
                    <div key={row.id} style={{ marginTop: 7, fontSize: 12 }}>
                      <a href={row.href} target="_blank" rel="noreferrer" style={linkStyle}>
                        {row.label}
                      </a>{" "}
                      <span style={{ color: DIM }}>
                        · {row.nextMove} · {row.defaultCloseAsk}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
          {v.topItems.length > 0 ? (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {v.topItems.slice(0, 6).map((item) => (
                <li
                  key={item.id}
                  style={{
                    borderTop: `1px dashed ${BORDER}`,
                    padding: "8px 2px",
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    gap: 10,
                    alignItems: "start",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>
                      {item.label}
                    </div>
                    <div style={{ fontSize: 12, color: DIM, marginTop: 2 }}>
                      {item.detail} · {item.nextAction}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color:
                        item.severity === "critical"
                          ? RED
                          : item.severity === "watch"
                            ? AMBER
                            : DIM,
                      textTransform: "uppercase",
                    }}
                  >
                    {item.severity}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ fontSize: 12, color: DIM }}>
              HubSpot has no proactive follow-up rows right now.
            </div>
          )}
          {v.notes.length > 0 ? (
            <div style={{ fontSize: 12, color: AMBER, marginTop: 8 }}>
              {v.notes.map((n) => `${n.source}: ${n.reason}`).join(" · ")}
            </div>
          ) : null}
        </>
      ))}
    </Section>
  );
}

function RetailProofSection({ report }: { report: Report }) {
  const s = report.retailProof.state;
  return (
    <Section
      title="Retail proof / store locator pipeline"
      link={report.retailProof.link}
    >
      {renderSourceState(s, (counts) => (
        <div style={{ display: "flex", gap: 18, fontSize: 13 }}>
          <span>
            Total drafts: <strong>{counts.total}</strong>
          </span>
          <span style={{ color: AMBER }}>
            Needs review: <strong>{counts.needs_review}</strong>
          </span>
          <span style={{ color: GREEN }}>
            Accepted: <strong>{counts.accepted}</strong>
          </span>
          <span style={{ color: RED }}>
            Rejected: <strong>{counts.rejected}</strong>
          </span>
        </div>
      ))}
    </Section>
  );
}

function AwaitingBenSection({ report }: { report: Report }) {
  const s = report.awaitingBen.state;
  return (
    <Section title="Slack approvals awaiting Ben">
      {renderSourceState(s, (v) => (
        <>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            Pending: <strong>{v.total}</strong> in {report.awaitingBen.slackChannel}
          </div>
          {v.preview.length === 0 ? (
            <div style={{ fontSize: 12, color: DIM }}>
              (no pending approvals)
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {v.preview.map((p) => (
                <li
                  key={p.id}
                  style={{
                    borderTop: `1px dashed ${BORDER}`,
                    padding: "6px 4px",
                    fontSize: 12,
                  }}
                >
                  <strong>{p.label ?? p.actionSlug}</strong>
                  <span style={{ color: DIM, marginLeft: 8 }}>
                    {p.targetType} · {p.actionSlug} ·{" "}
                    {p.createdAt.slice(0, 16).replace("T", " ")} UTC
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ))}
    </Section>
  );
}

function KpiScorecardSection({ report }: { report: Report }) {
  const k = report.kpiScorecard;
  const targetUsd = k.target.usd;
  const deadline = new Date(k.target.deadlineIso);
  const deadlineLabel = deadline.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const actual = k.actualLast7dUsd;
  const gap = k.gapToWeeklyPaceUsd;
  const fmtUsd = (n: number | null): string => {
    if (n === null || !Number.isFinite(n)) return "—";
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (Math.abs(n) >= 10_000) return `$${(n / 1000).toFixed(1)}K`;
    return `$${Math.round(n).toLocaleString("en-US")}`;
  };
  const channelLabel: Record<string, string> = {
    shopify: "Shopify DTC",
    amazon: "Amazon",
    faire: "Faire",
    b2b: "B2B (wholesale)",
    unknown: "Unattributed",
  };
  const statusColor: Record<string, string> = {
    wired: "#0a7c2f",
    not_wired: AMBER,
    error: RED,
  };
  const KpiTile = ({
    label,
    value,
    color = NAVY,
  }: {
    label: string;
    value: string;
    color?: string;
  }) => (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: "10px 12px",
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: DIM, marginTop: 4 }}>{label}</div>
    </div>
  );
  const gapText =
    gap === null
      ? "—"
      : gap >= 0
        ? `+${fmtUsd(gap)} ahead`
        : `${fmtUsd(gap)} behind`;
  const gapColor =
    gap === null ? NAVY : gap >= 0 ? "#0a7c2f" : RED;
  return (
    <Section title="Weekly KPI Scorecard">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <KpiTile
          label={`Target by ${deadlineLabel}`}
          value={fmtUsd(targetUsd)}
        />
        <KpiTile label="Days remaining" value={String(k.daysRemaining)} />
        <KpiTile label="Required / week" value={fmtUsd(k.requiredWeeklyUsd)} />
        <KpiTile
          label="Actual last 7d"
          value={actual === null ? "—" : fmtUsd(actual)}
        />
        <KpiTile label="Gap to pace" value={gapText} color={gapColor} />
        <KpiTile label="Confidence" value={k.confidence} />
      </div>
      {actual === null && (
        <div
          style={{
            fontSize: 12,
            color: AMBER,
            marginBottom: 8,
          }}
        >
          No revenue source wired — actual last 7d cannot be computed.
          Confidence: <strong>{k.confidence}</strong>.
        </div>
      )}
      <SubLabel>Channel sources</SubLabel>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {k.channels.map((c) => (
          <li
            key={c.channel}
            style={{
              borderTop: `1px dashed ${BORDER}`,
              padding: "6px 4px",
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              gap: 12,
              alignItems: "center",
              fontSize: 12,
            }}
          >
            <span
              style={{
                color: statusColor[c.status] ?? NAVY,
                fontWeight: 600,
                textTransform: "uppercase",
                fontSize: 10,
                letterSpacing: 0.4,
                whiteSpace: "nowrap",
              }}
            >
              {c.status === "not_wired" ? "not wired" : c.status}
            </span>
            <span>
              <strong>{channelLabel[c.channel] ?? c.channel}</strong>
              {c.reason && (
                <div style={{ color: DIM, marginTop: 2 }}>{c.reason}</div>
              )}
            </span>
            <span>
              {c.status === "wired" ? fmtUsd(c.amountUsd) : "—"}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function DispatchSummarySection({ report }: { report: Report }) {
  const ds = report.dispatchSummary;
  const tile = (
    s:
      | { status: "wired"; value: number }
      | { status: "not_wired" | "error"; reason: string },
    label: string,
    accent: string,
  ) => {
    const isWired = s.status === "wired";
    const value = isWired ? String(s.value) : "—";
    const subline = !isWired ? s.reason : undefined;
    return (
      <div
        style={{
          background: "#fff",
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          padding: "10px 12px",
          minWidth: 130,
        }}
      >
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: isWired ? accent : DIM,
            lineHeight: 1.1,
          }}
        >
          {value}
        </div>
        <div style={{ fontSize: 11, color: DIM, marginTop: 4 }}>{label}</div>
        {subline && (
          <div style={{ fontSize: 10, color: DIM, marginTop: 2, fontStyle: "italic" }}>
            {subline}
          </div>
        )}
      </div>
    );
  };

  const oldestNote = ds.oldestOpenShipDate
    ? `Oldest open package shipped ${ds.oldestOpenShipDate}`
    : null;

  return (
    <Section title="Dispatch (open vs. last 24h)">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 10,
          marginBottom: 10,
        }}
      >
        {tile(ds.openCount, "Open packages", "#c7a062")}
        {tile(ds.dispatchedLast24h, "Dispatched (last 24h)", NAVY)}
      </div>
      {oldestNote && (
        <div style={{ fontSize: 12, color: DIM, marginBottom: 8 }}>
          {oldestNote}
        </div>
      )}
      <a
        href={ds.deepLink}
        style={{
          display: "inline-block",
          fontSize: 12,
          color: NAVY,
          textDecoration: "underline",
        }}
      >
        Open Dispatch Board →
      </a>
    </Section>
  );
}

function AgingSection({ report }: { report: Report }) {
  const { topItems, counts, missingTimestamps, link } = report.aging;
  const tierColor: Record<string, string> = {
    critical: RED,
    overdue: AMBER,
    watch: NAVY,
    fresh: DIM,
  };
  return (
    <Section title="Aging / SLA" link={link}>
      {counts.total === 0 && missingTimestamps.length === 0 ? (
        <div style={{ fontSize: 12, color: DIM }}>
          No actionable rows pending across approvals, Faire follow-ups, AP
          packets, retail drafts, or receipts.
        </div>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              gap: 18,
              fontSize: 13,
              marginBottom: 8,
              flexWrap: "wrap",
            }}
          >
            <span style={{ color: tierColor.critical }}>
              Critical: <strong>{counts.critical}</strong>
            </span>
            <span style={{ color: tierColor.overdue }}>
              Overdue: <strong>{counts.overdue}</strong>
            </span>
            <span style={{ color: tierColor.watch }}>
              Watch: <strong>{counts.watch}</strong>
            </span>
            <span style={{ color: DIM }}>
              Fresh: <strong>{counts.fresh}</strong>
            </span>
            <span style={{ color: DIM }}>
              Total tracked: <strong>{counts.total}</strong>
            </span>
          </div>
          {topItems.length === 0 ? (
            <div style={{ fontSize: 12, color: DIM }}>
              All tracked rows are still in the &ldquo;fresh&rdquo; window.
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {topItems.map((row) => (
                <li
                  key={`${row.source}:${row.id}`}
                  style={{
                    borderTop: `1px dashed ${BORDER}`,
                    padding: "6px 4px",
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: 12,
                    alignItems: "center",
                    fontSize: 12,
                  }}
                >
                  <span
                    style={{
                      color: tierColor[row.tier] ?? NAVY,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      fontSize: 10,
                      letterSpacing: 0.4,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.tier}
                  </span>
                  <span>
                    <strong>{row.label}</strong>
                    <span style={{ color: DIM, marginLeft: 8 }}>
                      {row.source}
                    </span>
                  </span>
                  <span style={{ color: tierColor[row.tier] ?? NAVY }}>
                    {row.ageHours < 48
                      ? `${Math.floor(row.ageHours)}h`
                      : `${Math.floor(row.ageDays)}d`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {missingTimestamps.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <SubLabel>Timestamp missing — age cannot be computed</SubLabel>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {missingTimestamps.map((row) => (
                  <li
                    key={`${row.source}:${row.id}`}
                    style={{
                      borderTop: `1px dashed ${BORDER}`,
                      padding: "6px 4px",
                      fontSize: 12,
                    }}
                  >
                    <strong>{row.label}</strong>
                    <span style={{ color: DIM, marginLeft: 8 }}>
                      {row.source}
                    </span>
                    <div style={{ color: DIM, marginTop: 2 }}>
                      {row.reason}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function BlockersSection({ report }: { report: Report }) {
  const { missingEnv, notes, link } = report.blockers;
  if (missingEnv.length === 0 && notes.length === 0) {
    return (
      <Section title="Blockers / missing envs" link={link}>
        <div style={{ color: GREEN, fontSize: 12 }}>
          All wired sources reporting cleanly. No blockers detected.
        </div>
      </Section>
    );
  }
  return (
    <Section title="Blockers / missing envs" link={link}>
      {missingEnv.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <SubLabel>Missing env vars</SubLabel>
          <div style={{ fontSize: 12 }}>
            {missingEnv.map((name) => (
              <code
                key={name}
                style={{
                  background: `${AMBER}15`,
                  border: `1px solid ${AMBER}40`,
                  borderRadius: 4,
                  padding: "2px 6px",
                  marginRight: 6,
                  color: AMBER,
                }}
              >
                {name}
              </code>
            ))}
          </div>
        </div>
      )}
      {notes.length > 0 && (
        <div>
          <SubLabel>Source notes</SubLabel>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {notes.map((n) => (
              <li
                key={n.source}
                style={{
                  borderTop: `1px dashed ${BORDER}`,
                  padding: "6px 4px",
                  fontSize: 12,
                }}
              >
                <strong>{n.source}</strong>{" "}
                <span
                  style={{
                    color: n.state === "error" ? RED : AMBER,
                    fontSize: 10,
                    textTransform: "uppercase",
                    fontWeight: 600,
                    marginLeft: 4,
                    letterSpacing: 0.4,
                  }}
                >
                  {n.state}
                </span>
                <div style={{ color: DIM, marginTop: 2 }}>{n.reason}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function Section(props: {
  title: string;
  link?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <h2
          style={{
            color: NAVY,
            fontSize: 13,
            textTransform: "uppercase",
            margin: 0,
          }}
        >
          {props.title}
        </h2>
        {props.link && (
          <Link href={props.link.href} style={linkStyle}>
            {props.link.label} →
          </Link>
        )}
      </div>
      {props.children}
    </section>
  );
}

function Stat(props: {
  label: string;
  value: number | null;
  highlightColor: string;
  actionable: boolean;
  href?: string;
}) {
  const display = props.value === null ? "—" : String(props.value);
  const color = props.actionable ? props.highlightColor : NAVY;
  const inner = (
    <div
      style={{
        background: BG,
        border: `1px solid ${props.actionable ? props.highlightColor : BORDER}`,
        borderRadius: 8,
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color,
          lineHeight: 1.1,
        }}
      >
        {display}
      </div>
      <div style={{ fontSize: 11, color: DIM, marginTop: 4 }}>
        {props.label}
      </div>
      {props.value === null && (
        <div
          style={{
            fontSize: 10,
            color: AMBER,
            textTransform: "uppercase",
            marginTop: 4,
            fontWeight: 600,
            letterSpacing: 0.4,
          }}
        >
          not wired
        </div>
      )}
    </div>
  );
  if (props.href) {
    return (
      <Link href={props.href} style={{ textDecoration: "none" }}>
        {inner}
      </Link>
    );
  }
  return inner;
}

function MiniStat(props: { label: string; value: number; color?: string }) {
  return (
    <div
      style={{
        background: BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: "8px 10px",
        minWidth: 112,
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 800, color: props.color ?? NAVY }}>
        {props.value}
      </div>
      <div style={{ fontSize: 10, color: DIM, textTransform: "uppercase" }}>
        {props.label}
      </div>
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        color: DIM,
        textTransform: "uppercase",
        letterSpacing: 0.4,
        fontWeight: 600,
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: `${RED}10`,
        border: `1px solid ${RED}40`,
        borderRadius: 8,
        padding: "10px 12px",
        color: RED,
        fontSize: 13,
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  );
}

function renderSourceState<T>(
  state: SourceState<T>,
  onWired: (value: T) => React.ReactNode,
): React.ReactNode {
  if (state.status === "wired") return onWired(state.value);
  const tag = state.status === "error" ? "ERROR" : "NOT WIRED";
  const tagColor = state.status === "error" ? RED : AMBER;
  return (
    <div
      style={{
        background: BG,
        border: `1px dashed ${BORDER}`,
        borderRadius: 6,
        padding: "8px 10px",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: tagColor,
          textTransform: "uppercase",
          fontWeight: 600,
          letterSpacing: 0.4,
          marginBottom: 4,
        }}
      >
        {tag}
      </div>
      <div style={{ fontSize: 12, color: DIM }}>{state.reason}</div>
    </div>
  );
}

const linkStyle: React.CSSProperties = {
  fontSize: 12,
  color: NAVY,
  textDecoration: "underline",
};
