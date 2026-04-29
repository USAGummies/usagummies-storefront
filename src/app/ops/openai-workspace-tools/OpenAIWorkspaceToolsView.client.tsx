"use client";

import { useState } from "react";

import {
  CREAM,
  GOLD,
  NAVY,
  RED,
  SURFACE_BORDER as BORDER,
  SURFACE_CARD as CARD,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";
import type { WorkspaceToolDashboardSummary } from "@/lib/ops/openai-workspace-tools/dashboard";
import type {
  OpenAIWorkspaceTool,
  WorkspaceToolMode,
} from "@/lib/ops/openai-workspace-tools/registry";

const GREEN = "#15803d";
const AMBER = "#b45309";

const MODE_LABEL: Record<WorkspaceToolMode, string> = {
  read: "Read tools",
  approval_request: "Approval-request tools",
  prohibited: "Prohibited tools",
};

interface Props {
  grouped: Record<WorkspaceToolMode, readonly OpenAIWorkspaceTool[]>;
  summary: WorkspaceToolDashboardSummary;
}

interface ProbeState {
  status: "idle" | "loading" | "ready" | "error";
  detail: string;
}

export function OpenAIWorkspaceToolsView({ grouped, summary }: Props) {
  const [probe, setProbe] = useState<ProbeState>({
    status: "idle",
    detail: "Not checked in this browser session.",
  });

  async function checkConnector() {
    setProbe({ status: "loading", detail: "Checking MCP discovery route..." });
    try {
      const res = await fetch("/api/ops/openai-workspace-tools/mcp", {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as
        | { tools?: Array<{ name: string }> }
        | null;
      if (!res.ok) {
        setProbe({
          status: "error",
          detail: `HTTP ${res.status}. Connector discovery did not return OK.`,
        });
        return;
      }
      setProbe({
        status: "ready",
        detail: `${body?.tools?.length ?? 0} MCP tools exposed: ${(body?.tools ?? [])
          .map((tool) => tool.name)
          .join(", ")}`,
      });
    } catch (err) {
      setProbe({
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <main style={{ background: CREAM, minHeight: "100vh", padding: "24px 28px" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          alignItems: "flex-start",
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
        <div>
          <div
            style={{
              color: DIM,
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              fontWeight: 700,
            }}
          >
            Internal · ChatGPT workspace connector
          </div>
          <h1 style={{ color: NAVY, fontSize: 28, margin: "4px 0" }}>
            OpenAI Workspace Tools
          </h1>
          <p style={{ color: DIM, margin: 0, maxWidth: 840, fontSize: 13 }}>
            One allowlisted surface for ChatGPT workspace agents. ChatGPT may
            read approved ops surfaces and request Slack approvals; existing
            closers remain the only execution layer.
          </p>
        </div>
        <button
          onClick={() => void checkConnector()}
          disabled={probe.status === "loading"}
          style={{
            background: NAVY,
            color: "#fff",
            border: 0,
            borderRadius: 8,
            padding: "9px 14px",
            fontWeight: 700,
            cursor: probe.status === "loading" ? "not-allowed" : "pointer",
          }}
        >
          Check MCP Discovery
        </button>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Metric label="Total tools" value={summary.total} tone={NAVY} />
        <Metric label="Ready" value={summary.byStatus.ready} tone={GREEN} />
        <Metric label="Approval requests" value={summary.readyApprovalTools} tone={GOLD} />
        <Metric label="Blocked/prohibited" value={summary.blockedProhibitedTools} tone={RED} />
      </section>

      <section
        style={{
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: 0, color: NAVY, fontSize: 16 }}>
          Connector Readiness
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 0.7fr) minmax(260px, 1.3fr)",
            gap: 14,
            marginTop: 12,
          }}
        >
          <div
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: 10,
              padding: 12,
              background:
                summary.connectorReadiness === "ready"
                  ? "rgba(21,128,61,0.08)"
                  : "rgba(180,83,9,0.08)",
            }}
          >
            <div style={{ color: DIM, fontSize: 12 }}>Publish status</div>
            <div
              style={{
                color:
                  summary.connectorReadiness === "ready" ? GREEN : AMBER,
                fontWeight: 800,
                marginTop: 4,
              }}
            >
              {summary.connectorReadiness}
            </div>
            <p style={{ color: DIM, fontSize: 12, marginBottom: 0 }}>
              {summary.canExposeConnector
                ? "Dedicated connector bearer is configured. Publish the MCP URL in ChatGPT admin/dev mode."
                : "The page is usable internally, but ChatGPT connector publishing still needs the dedicated bearer secret."}
            </p>
          </div>
          <div
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: 10,
              padding: 12,
            }}
          >
            <div style={{ color: DIM, fontSize: 12 }}>Browser probe</div>
            <div style={{ color: probeColor(probe.status), fontWeight: 800 }}>
              {probe.status}
            </div>
            <p style={{ color: DIM, fontSize: 12, marginBottom: 0 }}>
              {probe.detail}
            </p>
          </div>
        </div>
        <ul style={{ color: DIM, fontSize: 12, marginBottom: 0 }}>
          {summary.nextActions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        {(["read", "approval_request", "prohibited"] as const).map((mode) => (
          <ToolColumn key={mode} mode={mode} tools={grouped[mode]} />
        ))}
      </section>

      <footer style={{ marginTop: 18, color: DIM, fontSize: 12 }}>
        MCP endpoint: <code>/api/ops/openai-workspace-tools/mcp</code>. Registry
        endpoint: <code>/api/ops/openai-workspace-tools</code>. This dashboard
        never calls QBO, Gmail, ShipStation, Shopify checkout, HubSpot
        stage/property writes, or the Faire API.
      </footer>
    </main>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div style={{ color: DIM, fontSize: 12 }}>{label}</div>
      <div style={{ color: tone, fontSize: 26, fontWeight: 900 }}>{value}</div>
    </div>
  );
}

function ToolColumn({
  mode,
  tools,
}: {
  mode: WorkspaceToolMode;
  tools: readonly OpenAIWorkspaceTool[];
}) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: 14,
      }}
    >
      <h2 style={{ color: GOLD, fontSize: 13, margin: 0, textTransform: "uppercase" }}>
        {MODE_LABEL[mode]} · {tools.length}
      </h2>
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {tools.map((tool) => (
          <article
            key={tool.id}
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: 10,
              padding: 12,
              background: "rgba(255,255,255,0.52)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                alignItems: "flex-start",
              }}
            >
              <div>
                <div style={{ color: NAVY, fontWeight: 800 }}>{tool.name}</div>
                <code style={{ color: DIM, fontSize: 11 }}>{tool.id}</code>
              </div>
              <Badge status={tool.status} />
            </div>
            <p style={{ color: DIM, fontSize: 12, margin: "8px 0" }}>
              {tool.description}
            </p>
            <div style={{ color: DIM, fontSize: 12 }}>
              Audience: <strong>{tool.audience}</strong>
            </div>
            {tool.approvalSlug && (
              <div style={{ color: DIM, fontSize: 12 }}>
                Approval: <code>{tool.approvalSlug}</code>
              </div>
            )}
            {tool.backingSurface && (
              <a
                href={tool.backingSurface}
                style={{ color: NAVY, fontSize: 12, fontWeight: 700 }}
              >
                Open source surface
              </a>
            )}
            {tool.blocker && (
              <p style={{ color: RED, fontSize: 12, marginBottom: 0 }}>
                Blocker: {tool.blocker}
              </p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function Badge({ status }: { status: OpenAIWorkspaceTool["status"] }) {
  const color =
    status === "ready" ? GREEN : status === "planned" ? AMBER : RED;
  return (
    <span
      style={{
        color,
        border: `1px solid ${color}40`,
        background: `${color}12`,
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 800,
        textTransform: "uppercase",
      }}
    >
      {status}
    </span>
  );
}

function probeColor(status: ProbeState["status"]) {
  if (status === "ready") return GREEN;
  if (status === "error") return RED;
  if (status === "loading") return GOLD;
  return DIM;
}
