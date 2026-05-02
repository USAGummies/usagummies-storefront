"use client";

import { useEffect, useMemo, useState } from "react";

import {
  CREAM as BG,
  GOLD,
  NAVY,
  RED,
  SURFACE_BORDER as BORDER,
  SURFACE_CARD as CARD,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";
import type {
  WorkpackDepartment,
  WorkpackIntent,
  WorkpackRiskClass,
  WorkpackStatus,
} from "@/lib/ops/workpacks";

const GREEN = "#15803d";
const AMBER = "#b45309";

interface WorkpackRecord {
  id: string;
  status: WorkpackStatus;
  intent: WorkpackIntent;
  department: WorkpackDepartment;
  title: string;
  sourceText: string;
  sourceUrl?: string;
  requestedBy?: string;
  allowedActions: string[];
  prohibitedActions: string[];
  riskClass: WorkpackRiskClass;
  createdAt: string;
  updatedAt: string;
}

interface WorkpacksResponse {
  ok: true;
  count: number;
  workpacks: WorkpackRecord[];
}

const STATUS_ORDER: WorkpackStatus[] = [
  "queued",
  "running",
  "needs_review",
  "approved",
  "done",
  "failed",
];

const STATUS_COLORS: Record<WorkpackStatus, string> = {
  queued: GOLD,
  running: AMBER,
  needs_review: AMBER,
  approved: GREEN,
  done: GREEN,
  failed: RED,
};

const INTENT_COPY: Record<WorkpackIntent, string> = {
  draft_reply: "Draft reply",
  prepare_codex_prompt: "Codex prompt",
  summarize_thread: "Summarize thread",
  research: "Research",
};

export function WorkpacksView() {
  const [data, setData] = useState<WorkpacksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      setData(null);
      try {
        const res = await fetch("/api/ops/workpacks?limit=100", {
          cache: "no-store",
        });
        const body = (await res.json().catch(() => ({}))) as
          | WorkpacksResponse
          | { error?: string };
        if (cancelled) return;
        if (!res.ok || (body as WorkpacksResponse).ok !== true) {
          setError((body as { error?: string }).error ?? `HTTP ${res.status}`);
          return;
        }
        setData(body as WorkpacksResponse);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const grouped = useMemo(() => {
    const base = Object.fromEntries(
      STATUS_ORDER.map((status) => [status, [] as WorkpackRecord[]]),
    ) as Record<WorkpackStatus, WorkpackRecord[]>;
    for (const workpack of data?.workpacks ?? []) {
      base[workpack.status]?.push(workpack);
    }
    return base;
  }, [data]);

  const queuedCount = grouped.queued.length + grouped.running.length;
  const reviewCount = grouped.needs_review.length + grouped.approved.length;

  return (
    <main style={{ background: BG, minHeight: "100vh", padding: "24px 28px" }}>
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
        <div style={{ maxWidth: 780 }}>
          <div style={eyebrow}>AI operator queue</div>
          <h1 style={{ color: NAVY, fontSize: 28, margin: "4px 0" }}>
            Workpacks
          </h1>
          <p style={bodyCopy}>
            Slack asks become bounded workpacks here. This page is read-only:
            it does not run Codex/Claude, send email, change HubSpot, write QBO,
            touch checkout, buy labels, or approve anything.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a href="/ops/slack" style={linkButton}>
            Slack diagnostics
          </a>
          <button
            type="button"
            onClick={() => setRefreshTick((n) => n + 1)}
            style={buttonStyle}
          >
            Refresh queue
          </button>
        </div>
      </header>

      {error && (
        <div
          style={{
            background: `${RED}10`,
            border: `1px solid ${RED}40`,
            borderRadius: 10,
            padding: "10px 12px",
            color: RED,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          Workpack fetch error: {error}
        </div>
      )}

      {data && (
        <>
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <Stat label="Total" value={data.count} color={NAVY} />
            <Stat label="Queued/running" value={queuedCount} color={GOLD} />
            <Stat label="Needs review" value={reviewCount} color={AMBER} />
            <Stat label="Done/failed" value={grouped.done.length + grouped.failed.length} color={DIM} />
          </section>

          {data.workpacks.length === 0 ? (
            <section style={cardStyle}>
              <h2 style={sectionTitle}>No workpacks queued</h2>
              <p style={bodyCopy}>
                Send a command in Slack like <code>ask codex summarize this thread</code>
                once the Slack event path is verified, or create workpacks
                through <code>POST /api/ops/workpacks</code>.
              </p>
            </section>
          ) : (
            STATUS_ORDER.map((status) => (
              <WorkpackSection
                key={status}
                status={status}
                workpacks={grouped[status]}
              />
            ))
          )}
        </>
      )}
    </main>
  );
}

function WorkpackSection({
  status,
  workpacks,
}: {
  status: WorkpackStatus;
  workpacks: WorkpackRecord[];
}) {
  if (workpacks.length === 0) return null;
  return (
    <section style={{ ...cardStyle, marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 10,
        }}
      >
        <h2 style={sectionTitle}>{status.replaceAll("_", " ")}</h2>
        <span
          style={{
            color: STATUS_COLORS[status],
            fontWeight: 800,
            fontSize: 12,
          }}
        >
          {workpacks.length}
        </span>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {workpacks.map((workpack) => (
          <WorkpackCard key={workpack.id} workpack={workpack} />
        ))}
      </div>
    </section>
  );
}

function WorkpackCard({ workpack }: { workpack: WorkpackRecord }) {
  return (
    <article
      style={{
        border: `1px solid ${BORDER}`,
        borderLeft: `4px solid ${STATUS_COLORS[workpack.status]}`,
        borderRadius: 10,
        padding: "12px 14px",
        background: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 260, flex: 1 }}>
          <div style={{ color: NAVY, fontSize: 16, fontWeight: 800 }}>
            {workpack.title}
          </div>
          <div style={{ color: DIM, fontSize: 12, marginTop: 3 }}>
            {INTENT_COPY[workpack.intent]} · {workpack.department} ·{" "}
            {workpack.requestedBy ?? "unknown requester"} ·{" "}
            {formatDate(workpack.createdAt)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <Badge
            text={workpack.riskClass.replaceAll("_", " ")}
            color={workpack.riskClass === "read_only" ? GREEN : AMBER}
          />
        </div>
      </div>

      <p
        style={{
          ...bodyCopy,
          marginTop: 10,
          whiteSpace: "pre-wrap",
          color: NAVY,
          maxHeight: 120,
          overflow: "hidden",
        }}
      >
        {workpack.sourceText}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 10,
          marginTop: 12,
        }}
      >
        <GuardrailBlock
          title="Allowed"
          items={workpack.allowedActions}
          empty="No explicit actions allowed yet."
          color={GREEN}
        />
        <GuardrailBlock
          title="Forbidden"
          items={workpack.prohibitedActions}
          empty="Default safety guardrails apply."
          color={RED}
        />
      </div>

      {workpack.sourceUrl && (
        <a
          href={workpack.sourceUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "inline-block",
            color: NAVY,
            fontSize: 12,
            fontWeight: 800,
            marginTop: 10,
          }}
        >
          Open source thread
        </a>
      )}
    </article>
  );
}

function GuardrailBlock({
  title,
  items,
  empty,
  color,
}: {
  title: string;
  items: string[];
  empty: string;
  color: string;
}) {
  return (
    <div
      style={{
        border: `1px dashed ${BORDER}`,
        borderRadius: 8,
        padding: "9px 10px",
        fontSize: 12,
      }}
    >
      <div style={{ ...eyebrow, color }}>{title}</div>
      {items.length > 0 ? (
        <ul style={{ margin: "6px 0 0 17px", padding: 0, color: DIM }}>
          {items.slice(0, 8).map((item) => (
            <li key={item}>
              <code>{item}</code>
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ color: DIM, marginTop: 6 }}>{empty}</div>
      )}
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
  color: string;
}) {
  return (
    <div style={cardStyle}>
      <div style={eyebrow}>{label}</div>
      <div style={{ color, fontSize: 28, fontWeight: 900, marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        border: `1px solid ${color}44`,
        background: `${color}12`,
        color,
        borderRadius: 999,
        padding: "4px 8px",
        fontSize: 11,
        fontWeight: 800,
        textTransform: "uppercase",
      }}
    >
      {text}
    </span>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const cardStyle: React.CSSProperties = {
  background: CARD,
  border: `1px solid ${BORDER}`,
  borderRadius: 12,
  padding: "14px 16px",
};

const sectionTitle: React.CSSProperties = {
  color: GOLD,
  fontSize: 13,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  margin: 0,
};

const eyebrow: React.CSSProperties = {
  color: DIM,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 800,
};

const bodyCopy: React.CSSProperties = {
  color: DIM,
  fontSize: 13,
  lineHeight: 1.5,
  margin: 0,
};

const buttonStyle: React.CSSProperties = {
  background: NAVY,
  color: "#fff",
  border: 0,
  borderRadius: 8,
  padding: "9px 14px",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
};

const linkButton: React.CSSProperties = {
  ...buttonStyle,
  display: "inline-block",
  textDecoration: "none",
  background: "#fff",
  color: NAVY,
  border: `1px solid ${BORDER}`,
};
