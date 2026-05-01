"use client";

/**
 * Today — single-glance morning surface.
 *
 * Aggregates pending approvals, off-grid quotes, agent health/graduation,
 * and pending sample drops into one rich card view. Posture chip
 * (green/yellow/red) gives a one-second answer to "is anything on
 * fire?"
 */
import { useCallback, useEffect, useState } from "react";

import {
  NAVY,
  GOLD,
  RED,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";

type Posture = "green" | "yellow" | "red";

interface ApprovalSummary {
  id: string;
  actorAgentId: string;
  action: string;
  class: "B" | "C";
  createdAt: string;
  escalateAt: string;
}

interface OffGridQuoteSummary {
  candidate: {
    id: string;
    customerName: string;
    pricePerBagUsd: number;
    bagCount: number;
  };
  severity: string;
  nearestGridPrice: number;
  deviationPerBagUsd: number;
  totalDeviationUsd: number;
  reason: string;
}

interface Digest {
  generatedAt: string;
  posture: Posture;
  approvals: {
    total: number;
    byClass: { B: number; C: number };
    escalating: number;
    expiring: number;
    oldest: ApprovalSummary[];
  };
  offGrid: {
    total: number;
    bySeverity: Record<string, number>;
    hasHardBlock: boolean;
    top: OffGridQuoteSummary[];
  };
  agents: {
    health: {
      total: number;
      green: number;
      yellow: number;
      red: number;
    };
    graduation: { total: number; readyToGraduate: number };
    redLight: Array<{ id: string; name: string; reason: string }>;
    readyToGraduate: Array<{
      id: string;
      name: string;
      currentStage: string;
      nextStage: string;
    }>;
  };
  samples: { pendingApprovals: number; whaleApprovals: number };
  degraded: string[];
}

const GREEN = "#16a34a";
const YELLOW = "#eab308";

const POSTURE_COLOR: Record<Posture, string> = {
  green: GREEN,
  yellow: YELLOW,
  red: RED,
};

const POSTURE_LABEL: Record<Posture, string> = {
  green: "ALL CLEAR",
  yellow: "ATTENTION",
  red: "HOT",
};

const POSTURE_TAGLINE: Record<Posture, string> = {
  green: "🇺🇸 Nothing waiting. Go get the next deal.",
  yellow: "Routine items waiting — handle when ready.",
  red: "Items at risk — operator action needed now.",
};

function timeAgo(iso: string): string {
  const ageMs = Date.now() - new Date(iso).getTime();
  if (ageMs < 0) return "future?";
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)}s ago`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.round(ageMs / 3_600_000)}h ago`;
  return `${Math.round(ageMs / 86_400_000)}d ago`;
}

export function TodayView() {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ops/today", { cache: "no-store" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
      }
      const json = (await res.json()) as { ok: boolean; digest: Digest };
      setDigest(json.digest);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 120_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: "0 auto", color: NAVY }}>
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
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>
            🇺🇸 TODAY
          </h1>
          <div style={{ fontSize: 13, color: DIM, marginTop: 4 }}>
            One-glance morning surface. Refreshes every 2 minutes.
          </div>
        </div>
        {digest && (
          <PostureChip
            posture={digest.posture}
            tagline={POSTURE_TAGLINE[digest.posture]}
          />
        )}
      </div>

      {error && (
        <Banner tone="red">❌ {error}</Banner>
      )}

      {digest && digest.degraded.length > 0 && (
        <Banner tone="yellow">
          ⚠️ Degraded sources: {digest.degraded.join(" · ")}
        </Banner>
      )}

      {digest && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
            gap: 16,
          }}
        >
          {/* APPROVALS */}
          <Card title="✅ Approvals" linkHref="/ops/approvals">
            <div style={statsRow}>
              <Stat label="Pending" value={digest.approvals.total} />
              <Stat label="Class B" value={digest.approvals.byClass.B} />
              <Stat label="Class C" value={digest.approvals.byClass.C} />
              <Stat
                label="Escalating"
                value={digest.approvals.escalating}
                color={digest.approvals.escalating > 0 ? YELLOW : undefined}
              />
              <Stat
                label="Expiring"
                value={digest.approvals.expiring}
                color={digest.approvals.expiring > 0 ? RED : undefined}
              />
            </div>
            {digest.approvals.oldest.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={hdr}>Oldest pending</div>
                {digest.approvals.oldest.map((a) => (
                  <div key={a.id} style={listRow}>
                    <span
                      style={{
                        fontFamily: "ui-monospace, Menlo, monospace",
                        fontSize: 11,
                        color: DIM,
                      }}
                    >
                      {a.actorAgentId}
                    </span>
                    <span style={{ flex: 1, marginLeft: 8 }}>{a.action}</span>
                    <span style={{ fontSize: 11, color: DIM }}>
                      Class {a.class} · {timeAgo(a.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* OFF-GRID PRICING */}
          <Card title="⚠️ Off-Grid Quotes (24h)" linkHref="/ops/finance/off-grid">
            <div style={statsRow}>
              <Stat label="Total" value={digest.offGrid.total} />
              <Stat
                label="Below floor"
                value={digest.offGrid.bySeverity.below_floor || 0}
                color={
                  digest.offGrid.bySeverity.below_floor > 0 ? RED : undefined
                }
              />
              <Stat
                label="Below dist"
                value={digest.offGrid.bySeverity.below_distributor_floor || 0}
              />
              <Stat
                label="Between"
                value={digest.offGrid.bySeverity.between_grid_lines || 0}
              />
              <Stat
                label="Above"
                value={digest.offGrid.bySeverity.above_grid || 0}
              />
            </div>
            {digest.offGrid.hasHardBlock && (
              <Banner tone="red" tight>
                🚨 At least one quote is below the $2.12 minimum-margin floor.
                Class C `pricing.change` required to ship.
              </Banner>
            )}
            {digest.offGrid.top.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={hdr}>Top severity</div>
                {digest.offGrid.top.map((q) => (
                  <div key={q.candidate.id} style={listRow}>
                    <span style={{ flex: 1 }}>{q.candidate.customerName}</span>
                    <span
                      style={{
                        fontFamily: "ui-monospace, Menlo, monospace",
                        fontSize: 11,
                        color: NAVY,
                      }}
                    >
                      ${q.candidate.pricePerBagUsd.toFixed(2)} ({q.severity})
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* AGENTS */}
          <Card title="🤖 Agents" linkHref="/ops/agents/status">
            <div style={statsRow}>
              <Stat
                label="Green"
                value={digest.agents.health.green}
                color={GREEN}
              />
              <Stat
                label="Yellow"
                value={digest.agents.health.yellow}
                color={YELLOW}
              />
              <Stat
                label="Red"
                value={digest.agents.health.red}
                color={digest.agents.health.red > 0 ? RED : undefined}
              />
              <Stat
                label="Ready ▲"
                value={digest.agents.graduation.readyToGraduate}
                color={
                  digest.agents.graduation.readyToGraduate > 0 ? GOLD : undefined
                }
              />
            </div>
            {digest.agents.redLight.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={hdr}>Red-light</div>
                {digest.agents.redLight.map((a) => (
                  <div key={a.id} style={listRow}>
                    <span style={{ flex: 1 }}>{a.name}</span>
                    <span style={{ fontSize: 11, color: RED }}>{a.reason}</span>
                  </div>
                ))}
              </div>
            )}
            {digest.agents.readyToGraduate.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={hdr}>Ready to graduate</div>
                {digest.agents.readyToGraduate.map((a) => (
                  <div key={a.id} style={listRow}>
                    <span style={{ flex: 1 }}>{a.name}</span>
                    <span
                      style={{
                        fontSize: 11,
                        color: GREEN,
                        fontWeight: 700,
                      }}
                    >
                      {a.currentStage} → {a.nextStage}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* SAMPLES */}
          <Card title="📦 Sample Drops" linkHref="/ops/sample-queue">
            <div style={statsRow}>
              <Stat label="Pending" value={digest.samples.pendingApprovals} />
              <Stat
                label="🐳 Whales"
                value={digest.samples.whaleApprovals}
                color={
                  digest.samples.whaleApprovals > 0 ? GOLD : undefined
                }
              />
            </div>
            <div style={{ fontSize: 11, color: DIM, marginTop: 10, lineHeight: 1.6 }}>
              Open sample-related approvals. Whales flagged on
              substring match — Buc-ee&apos;s, KeHE, McLane, Eastern
              National, Xanterra, Delaware North, Aramark, Compass, Sodexo.
            </div>
          </Card>
        </div>
      )}

      {digest && (
        <div
          style={{
            marginTop: 18,
            padding: "12px 14px",
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            fontSize: 12,
            color: DIM,
            lineHeight: 1.6,
          }}
        >
          Generated {new Date(digest.generatedAt).toLocaleTimeString()}.
          Posture priority: 🚨 below-floor pricing &gt; expiring approvals
          &gt; red-light agents &gt; pending approvals / off-grid quotes /
          escalating approvals &gt; clean.
        </div>
      )}
    </div>
  );
}

const statsRow: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
};

const hdr: React.CSSProperties = {
  fontSize: 11,
  color: DIM,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 4,
};

const listRow: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  padding: "4px 0",
  borderBottom: `1px dashed ${BORDER}`,
  fontSize: 12,
  color: NAVY,
};

function PostureChip({
  posture,
  tagline,
}: {
  posture: Posture;
  tagline: string;
}) {
  const color = POSTURE_COLOR[posture];
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        border: `2px solid ${color}`,
        background: `${color}15`,
        padding: "8px 16px",
        borderRadius: 999,
      }}
    >
      <span style={{ fontSize: 18, color, fontWeight: 800 }}>●</span>
      <div>
        <div
          style={{
            fontSize: 12,
            color,
            fontWeight: 800,
            letterSpacing: 1,
          }}
        >
          {POSTURE_LABEL[posture]}
        </div>
        <div style={{ fontSize: 11, color: NAVY, opacity: 0.8 }}>{tagline}</div>
      </div>
    </div>
  );
}

function Card({
  title,
  linkHref,
  children,
}: {
  title: string;
  linkHref?: string;
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
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
        {linkHref && (
          <a
            href={linkHref}
            style={{
              fontSize: 11,
              color: DIM,
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            open →
          </a>
        )}
      </div>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div
      style={{
        flex: "1 1 auto",
        minWidth: 60,
        padding: "8px 10px",
        background: "rgba(27,42,74,0.03)",
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 11, color: DIM, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color ?? NAVY }}>
        {value}
      </div>
    </div>
  );
}

function Banner({
  tone,
  tight,
  children,
}: {
  tone: "red" | "yellow";
  tight?: boolean;
  children: React.ReactNode;
}) {
  const c = tone === "red" ? RED : YELLOW;
  return (
    <div
      style={{
        border: `1px solid ${c}55`,
        background: `${c}0d`,
        borderRadius: 10,
        padding: tight ? "6px 10px" : "12px 16px",
        marginTop: tight ? 8 : 0,
        marginBottom: tight ? 0 : 16,
        fontSize: 12,
        color: tone === "red" ? RED : NAVY,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}
