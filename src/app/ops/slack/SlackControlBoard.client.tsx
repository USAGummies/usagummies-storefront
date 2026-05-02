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

const GREEN = "#15803d";
const AMBER = "#b45309";

interface SlackChannelRow {
  id: string;
  name: string;
  slackChannelId: string | null;
  hasChannelId: boolean;
}

interface SelfTestReadiness {
  ok: true;
  env: {
    slackBotTokenPresent: boolean;
    slackSigningSecretPresent: boolean;
  };
  urls: {
    events: string;
    interactivity: string;
  };
  activeChannels: SlackChannelRow[];
  requiredScopes: string[];
}

interface SelfTestPostResult {
  ok: boolean;
  posted: boolean;
  channel: string;
  ts: string | null;
  error: string | null;
  degraded: boolean;
}

interface SlackEventReceipt {
  id: string;
  eventType: string;
  channel?: string;
  messageTs?: string;
  subtype?: string;
  botIdPresent: boolean;
  recognized: boolean;
  recognizedCommand?: string;
  skippedReason?: string;
  textSnippet?: string;
  createdAt: string;
}

interface SlackEventLedgerResponse {
  ok: true;
  count: number;
  receipts: SlackEventReceipt[];
  totals: { recognized: number; skipped: number };
}

export function SlackControlBoard() {
  const [data, setData] = useState<SelfTestReadiness | null>(null);
  const [ledger, setLedger] = useState<SlackEventLedgerResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState("ops-daily");
  const [posting, setPosting] = useState(false);
  const [postResult, setPostResult] = useState<SelfTestPostResult | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadError(null);
      setLedgerError(null);
      setData(null);
      setLedger(null);
      try {
        const [res, ledgerRes] = await Promise.all([
          fetch("/api/ops/slack/self-test", { cache: "no-store" }),
          fetch("/api/ops/slack/events/ledger?limit=25", {
            cache: "no-store",
          }),
        ]);
        const body = (await res.json().catch(() => ({}))) as
          | SelfTestReadiness
          | { error?: string };
        if (cancelled) return;
        if (!res.ok || (body as SelfTestReadiness).ok !== true) {
          setLoadError((body as { error?: string }).error ?? `HTTP ${res.status}`);
          return;
        }
        setData(body as SelfTestReadiness);
        const ledgerBody = (await ledgerRes.json().catch(() => ({}))) as
          | SlackEventLedgerResponse
          | { error?: string };
        if (!ledgerRes.ok || (ledgerBody as SlackEventLedgerResponse).ok !== true) {
          setLedgerError(
            (ledgerBody as { error?: string }).error ?? `HTTP ${ledgerRes.status}`,
          );
          return;
        }
        setLedger(ledgerBody as SlackEventLedgerResponse);
      } catch (err) {
        if (!cancelled)
          setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const channelOptions = useMemo(
    () =>
      (data?.activeChannels ?? []).filter(
        (channel) => channel.hasChannelId && channel.slackChannelId,
      ),
    [data],
  );

  async function postVisualSelfTest() {
    setPosting(true);
    setPostResult(null);
    try {
      const res = await fetch("/api/ops/slack/self-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: selectedChannel }),
      });
      const body = (await res.json().catch(() => ({}))) as SelfTestPostResult;
      setPostResult({
        ok: Boolean(body.ok),
        posted: Boolean(body.posted),
        channel: body.channel ?? selectedChannel,
        ts: body.ts ?? null,
        error: body.error ?? (res.ok ? null : `HTTP ${res.status}`),
        degraded: Boolean(body.degraded),
      });
    } catch (err) {
      setPostResult({
        ok: false,
        posted: false,
        channel: selectedChannel,
        ts: null,
        error: err instanceof Error ? err.message : String(err),
        degraded: true,
      });
    } finally {
      setPosting(false);
    }
  }

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
        <div style={{ maxWidth: 760 }}>
          <div
            style={{
              color: DIM,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Slack · Control board
          </div>
          <h1 style={{ color: NAVY, fontSize: 28, margin: "4px 0" }}>
            Slack Command Station
          </h1>
          <p style={{ color: DIM, margin: 0, fontSize: 13, lineHeight: 1.55 }}>
            Verify the real production Slack bot path, channel registry, event
            URLs, and visual Block Kit rendering. This page is diagnostic except
            for the explicit self-test post button.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRefreshTick((n) => n + 1)}
          style={buttonStyle("secondary")}
        >
          Refresh diagnostics
        </button>
      </header>

      {loadError && (
        <Banner tone="error">
          Slack diagnostics failed to load: {loadError}
        </Banner>
      )}

      {data && (
        <>
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <SignalCard
              label="Bot token"
              value={data.env.slackBotTokenPresent ? "Present" : "Missing"}
              tone={data.env.slackBotTokenPresent ? "good" : "bad"}
              detail="Required for bot-authored cards, files, and thread replies."
            />
            <SignalCard
              label="Signing secret"
              value={data.env.slackSigningSecretPresent ? "Present" : "Missing"}
              tone={data.env.slackSigningSecretPresent ? "good" : "bad"}
              detail="Required for verified Slack interactivity and approval clicks."
            />
            <SignalCard
              label="Active channels"
              value={String(data.activeChannels.length)}
              tone={data.activeChannels.length > 0 ? "good" : "bad"}
              detail="Canonical registry rows the ops system is allowed to target."
            />
          </section>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(280px, 1fr) minmax(280px, 1fr)",
              gap: 16,
              alignItems: "stretch",
              marginBottom: 16,
            }}
          >
            <Card title="Visual self-test">
              <p style={bodyCopy}>
                Posts one Block Kit card from the production bot. If this fails,
                the response tells us whether the issue is token, channel
                membership, scope, or deploy.
              </p>
              <label
                style={{
                  display: "block",
                  color: DIM,
                  fontSize: 12,
                  fontWeight: 700,
                  marginBottom: 6,
                }}
              >
                Target channel
              </label>
              <select
                value={selectedChannel}
                onChange={(event) => setSelectedChannel(event.target.value)}
                style={{
                  width: "100%",
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                  padding: "9px 10px",
                  color: NAVY,
                  background: "#fff",
                  marginBottom: 10,
                }}
              >
                {channelOptions.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.name} · {channel.slackChannelId}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={postVisualSelfTest}
                disabled={posting || !data.env.slackBotTokenPresent}
                style={buttonStyle("primary", posting || !data.env.slackBotTokenPresent)}
              >
                {posting ? "Posting..." : "Post visual self-test card"}
              </button>
              {!data.env.slackBotTokenPresent && (
                <p style={{ ...bodyCopy, color: RED, marginTop: 10 }}>
                  Blocked because SLACK_BOT_TOKEN is missing in this runtime.
                </p>
              )}
              {postResult && (
                <div
                  style={{
                    marginTop: 12,
                    border: `1px solid ${postResult.ok ? `${GREEN}44` : `${RED}44`}`,
                    background: postResult.ok ? `${GREEN}10` : `${RED}10`,
                    borderRadius: 10,
                    padding: "10px 12px",
                    color: postResult.ok ? GREEN : RED,
                    fontSize: 13,
                  }}
                >
                  {postResult.ok
                    ? `Posted to ${postResult.channel} at ${postResult.ts}.`
                    : `Slack post failed: ${postResult.error ?? "unknown_error"}.`}
                </div>
              )}
            </Card>

            <Card title="Expected Slack app URLs">
              <UrlRow label="Events" value={data.urls.events} />
              <UrlRow label="Interactivity" value={data.urls.interactivity} />
              <div style={{ marginTop: 12 }}>
                <div style={smallLabel}>Required scopes</div>
                <ul style={{ margin: "8px 0 0 18px", color: DIM, fontSize: 12 }}>
                  {data.requiredScopes.map((scope) => (
                    <li key={scope}>{scope}</li>
                  ))}
                </ul>
              </div>
            </Card>
          </section>

          <Card title="Canonical channel registry">
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
                    <Th>System id</Th>
                    <Th>Slack channel</Th>
                    <Th>Channel id</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.activeChannels.map((channel) => (
                    <tr
                      key={channel.id}
                      style={{ borderTop: `1px dashed ${BORDER}` }}
                    >
                      <Td>
                        <code>{channel.id}</code>
                      </Td>
                      <Td>#{channel.name}</Td>
                      <Td>
                        <code>{channel.slackChannelId ?? "missing"}</code>
                      </Td>
                      <Td
                        style={{
                          color: channel.hasChannelId ? GREEN : RED,
                          fontWeight: 700,
                        }}
                      >
                        {channel.hasChannelId ? "ready" : "missing id"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <section style={{ marginTop: 16 }}>
            <Card title="Recent Slack Events">
              {ledgerError && (
                <Banner tone="warn">
                  Slack event ledger unavailable: {ledgerError}
                </Banner>
              )}
              {ledger && (
                <>
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      flexWrap: "wrap",
                      marginBottom: 10,
                    }}
                  >
                    <MiniPill
                      label="Receipts"
                      value={ledger.count}
                      color={NAVY}
                    />
                    <MiniPill
                      label="Recognized"
                      value={ledger.totals.recognized}
                      color={GREEN}
                    />
                    <MiniPill
                      label="Skipped"
                      value={ledger.totals.skipped}
                      color={AMBER}
                    />
                  </div>
                  {ledger.receipts.length === 0 ? (
                    <p style={bodyCopy}>
                      No Slack Events receipts recorded yet. If self-test posts
                      work but this table stays empty after a real Slack
                      message, Slack App Event Subscriptions are not delivering
                      to production.
                    </p>
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
                            <Th>Time</Th>
                            <Th>Channel</Th>
                            <Th>Type</Th>
                            <Th>Command</Th>
                            <Th>Skipped</Th>
                            <Th>Snippet</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {ledger.receipts.map((receipt) => (
                            <tr
                              key={receipt.id}
                              style={{ borderTop: `1px dashed ${BORDER}` }}
                            >
                              <Td>{formatDate(receipt.createdAt)}</Td>
                              <Td>
                                <code>{receipt.channel ?? "—"}</code>
                              </Td>
                              <Td>
                                {receipt.eventType}
                                {receipt.subtype ? ` · ${receipt.subtype}` : ""}
                                {receipt.botIdPresent ? " · bot" : ""}
                              </Td>
                              <Td
                                style={{
                                  color: receipt.recognized ? GREEN : DIM,
                                  fontWeight: receipt.recognized ? 800 : 500,
                                }}
                              >
                                {receipt.recognizedCommand ?? "—"}
                              </Td>
                              <Td
                                style={{
                                  color: receipt.skippedReason ? AMBER : DIM,
                                }}
                              >
                                {receipt.skippedReason ?? "—"}
                              </Td>
                              <Td style={{ color: DIM }}>
                                {receipt.textSnippet ?? "—"}
                              </Td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </Card>
          </section>
        </>
      )}
    </main>
  );
}

function SignalCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "good" | "bad" | "warn";
}) {
  const color = tone === "good" ? GREEN : tone === "warn" ? AMBER : RED;
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 12,
        padding: "14px 16px",
      }}
    >
      <div style={smallLabel}>{label}</div>
      <div style={{ color, fontSize: 22, fontWeight: 800, marginTop: 4 }}>
        {value}
      </div>
      <p style={{ ...bodyCopy, marginTop: 6 }}>{detail}</p>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: "14px 16px",
      }}
    >
      <h2
        style={{
          color: GOLD,
          fontSize: 13,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          margin: "0 0 10px 0",
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Banner({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "error" | "warn";
}) {
  const color = tone === "error" ? RED : AMBER;
  return (
    <div
      style={{
        background: `${color}10`,
        border: `1px solid ${color}40`,
        borderRadius: 10,
        padding: "10px 12px",
        color,
        fontSize: 13,
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  );
}

function UrlRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "110px 1fr",
        gap: 10,
        alignItems: "baseline",
        padding: "8px 0",
        borderBottom: `1px dashed ${BORDER}`,
      }}
    >
      <div style={smallLabel}>{label}</div>
      <code style={{ color: NAVY, wordBreak: "break-all", fontSize: 12 }}>
        {value}
      </code>
    </div>
  );
}

function MiniPill({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 6,
        border: `1px solid ${color}33`,
        background: `${color}0f`,
        color,
        borderRadius: 999,
        padding: "5px 9px",
        fontSize: 12,
        fontWeight: 800,
      }}
    >
      {label}: {value}
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

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ padding: "8px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>
      {children}
    </th>
  );
}

function Td({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <td
      style={{
        padding: "9px 8px",
        color: NAVY,
        verticalAlign: "top",
        ...style,
      }}
    >
      {children}
    </td>
  );
}

function buttonStyle(kind: "primary" | "secondary", disabled = false) {
  return {
    background: kind === "primary" ? NAVY : "#fff",
    color: kind === "primary" ? "#fff" : NAVY,
    border: `1px solid ${kind === "primary" ? NAVY : BORDER}`,
    borderRadius: 8,
    padding: "9px 14px",
    fontSize: 13,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.58 : 1,
  } satisfies React.CSSProperties;
}

const smallLabel: React.CSSProperties = {
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
