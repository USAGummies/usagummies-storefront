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

interface Report {
  generatedAt: string;
  todaysRevenueActions: {
    faireInvitesNeedsReview: number | null;
    faireFollowUpsActionable: number | null;
    pendingApprovals: number | null;
    retailDraftsNeedsReview: number | null;
    apPacketsActionRequired: number | null;
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
    apPackets: SourceState<ApPacketCounts>;
    links: Array<{ href: string; label: string }>;
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
          <RetailProofSection report={data} />
          <AwaitingBenSection report={data} />
          <KpiScorecardSection report={data} />
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
