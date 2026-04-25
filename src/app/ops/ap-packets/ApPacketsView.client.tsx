"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import {
  NAVY,
  RED,
  GOLD,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";
import type { ApPacket, ApPacketAttachment } from "@/lib/ops/ap-packets";
import {
  deriveDashboardRow,
  hasPacketTemplateRegistry,
  summarizeDashboard,
  type DashboardRow,
  type PacketRosterRow,
} from "@/lib/ops/ap-packet-dashboard";

type PacketResponse = {
  ok: boolean;
  packet?: ApPacket;
  error?: string;
  lastSent?: {
    sentAt: string;
    sentBy: string;
    messageId: string;
    threadId: string | null;
    approvalId?: string | null;
    subject?: string | null;
  } | null;
};

type RosterResponse = {
  ok: boolean;
  packets?: PacketRosterRow[];
  error?: string;
};

const GREEN = "#15803d";
const AMBER = "#b45309";

function statusColor(status: ApPacketAttachment["status"]) {
  if (status === "ready") return GREEN;
  if (status === "optional") return GOLD;
  if (status === "review") return AMBER;
  return RED;
}

function statusLabel(status: ApPacketAttachment["status"]) {
  if (status === "ready") return "Ready";
  if (status === "optional") return "Optional";
  if (status === "review") return "Review";
  return "Missing";
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Best-effort only.
  }
}

export function ApPacketsView() {
  const [packet, setPacket] = useState<ApPacket | null>(null);
  const [packetLastSent, setPacketLastSent] = useState<
    PacketResponse["lastSent"] | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [roster, setRoster] = useState<PacketRosterRow[]>([]);
  const [rosterErr, setRosterErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [detailRes, rosterRes] = await Promise.all([
        fetch("/api/ops/ap-packets?account=jungle-jims", { cache: "no-store" }),
        fetch("/api/ops/ap-packets", { cache: "no-store" }),
      ]);
      const detailData = (await detailRes.json()) as PacketResponse;
      if (!detailRes.ok || !detailData.packet) {
        throw new Error(detailData.error || `HTTP ${detailRes.status}`);
      }
      setPacket(detailData.packet);
      setPacketLastSent(detailData.lastSent ?? null);

      // Roster — best-effort. A failure here doesn't block the JJ
      // detail panel; surfaces as a banner in the roster section only.
      try {
        const rosterData = (await rosterRes.json()) as RosterResponse;
        if (rosterRes.ok && Array.isArray(rosterData.packets)) {
          setRoster(rosterData.packets);
          setRosterErr(null);
        } else {
          setRoster([]);
          setRosterErr(rosterData.error || `Roster HTTP ${rosterRes.status}`);
        }
      } catch (err) {
        setRoster([]);
        setRosterErr(err instanceof Error ? err.message : String(err));
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPacket(null);
      setPacketLastSent(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const attachmentSummary = useMemo(() => {
    if (!packet) return { ready: 0, blocked: 0 };
    return packet.attachments.reduce(
      (acc, item) => {
        if (item.status === "ready") acc.ready += 1;
        if (item.status === "missing") acc.blocked += 1;
        return acc;
      },
      { ready: 0, blocked: 0 },
    );
  }, [packet]);

  const handleCopy = useCallback(async (key: string, value: string) => {
    await copy(value);
    setCopied(key);
    setTimeout(() => setCopied((current) => (current === key ? null : current)), 1800);
  }, []);

  const downloadCsv = useCallback(() => {
    if (!packet) return;
    const url = `/api/ops/ap-packets?account=${packet.slug}&format=csv`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [packet]);

  return (
    <div style={{ padding: 24, maxWidth: 1240, margin: "0 auto", color: NAVY }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "flex-start",
          marginBottom: 18,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>
            Retailer AP Packets
          </h1>
          <div style={{ marginTop: 6, fontSize: 13, color: DIM }}>
            Internal packet workspace for retailer and AP onboarding. Start with Jungle Jim&apos;s.
          </div>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            background: CARD,
            color: NAVY,
            padding: "9px 14px",
            fontSize: 13,
            fontWeight: 700,
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <div
          style={{
            border: `1px solid ${RED}55`,
            borderRadius: 12,
            background: `${RED}0d`,
            color: RED,
            padding: "12px 16px",
            fontSize: 13,
            marginBottom: 18,
          }}
        >
          {error}
        </div>
      ) : null}

      <RosterSection
        roster={roster}
        rosterErr={rosterErr}
        loading={loading}
        activeSlug={packet?.slug ?? null}
      />

      {!loading && packet ? (
        <>
          <PacketDetailHeader packet={packet} lastSent={packetLastSent} />
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
              marginBottom: 18,
            }}
          >
            <HeaderCard label="Account" value={packet.accountName} hint={packet.apEmail} />
            <HeaderCard label="Owner" value={packet.owner} hint={packet.dueWindow} />
            <HeaderCard
              label="Attachments Ready"
              value={`${attachmentSummary.ready}/${packet.attachments.length}`}
              hint={attachmentSummary.blocked > 0 ? `${attachmentSummary.blocked} still blocked` : "All required files staged"}
            />
            <HeaderCard
              label="Pricing Review"
              value={packet.pricingNeedsReview ? "Required" : "Locked"}
              hint={packet.pricingNeedsReview ? "Review case cost before send" : "No open pricing caveats"}
            />
          </section>

          {packet.pricingNeedsReview ? (
            <div
              style={{
                border: `1px solid ${RED}44`,
                borderRadius: 12,
                background: `${RED}0d`,
                padding: "14px 16px",
                marginBottom: 18,
              }}
            >
              <div style={{ fontWeight: 800, color: RED, marginBottom: 6 }}>
                Pricing review required before send
              </div>
              <div style={{ fontSize: 13, color: NAVY }}>
                The item list uses a derived case cost of <strong>$20.94</strong> from the prior Jungle Jim&apos;s buyer quote at $3.49 per bag. Ben or Rene should confirm that line before the final AP packet goes out.
              </div>
            </div>
          ) : null}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(320px, 1fr) minmax(320px, 1fr)",
              gap: 18,
              alignItems: "start",
            }}
          >
            <CardSection title="Packet workflow">
              <OrderedList items={packet.nextActions} />
            </CardSection>

            <CardSection title="Retailer requirements">
              <OrderedList items={packet.retailerRequirements} />
            </CardSection>

            <CardSection title="Company profile">
              <DefinitionGrid
                rows={[
                  ["Legal name", packet.companyProfile.legalCompanyName],
                  ["DBA", packet.companyProfile.dba],
                  ["EIN", packet.companyProfile.ein],
                  ["Remit-to", packet.companyProfile.remitToAddress],
                  ["Website", packet.companyProfile.website],
                  ["Company phone", packet.companyProfile.companyPhone],
                  ["AP email", packet.companyProfile.apEmail],
                  ["Sales email", packet.companyProfile.salesEmail],
                  ["Terms", packet.companyProfile.paymentTerms],
                  ["Methods", packet.companyProfile.paymentMethods],
                  ["PO requirement", packet.companyProfile.poRequirement],
                  ["Bank", packet.companyProfile.bankName],
                  ["ACH routing", packet.companyProfile.achRouting],
                  ["Wire routing", packet.companyProfile.wireRouting],
                  ["Bank account name", packet.companyProfile.accountName],
                ]}
                onCopy={handleCopy}
                copied={copied}
              />
            </CardSection>

            <CardSection title="Field map for the vendor packet">
              <div style={{ display: "grid", gap: 10 }}>
                {packet.fieldMap.map((field) => (
                  <div
                    key={field.label}
                    style={{
                      border: `1px solid ${BORDER}`,
                      borderRadius: 10,
                      padding: "10px 12px",
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: DIM }}>
                      {field.label}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 14, fontWeight: 700 }}>{field.value}</div>
                    {field.note ? (
                      <div style={{ marginTop: 4, fontSize: 12, color: DIM }}>{field.note}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </CardSection>
          </div>

          <CardSection title="Attachments to send" style={{ marginTop: 18 }}>
            <div style={{ display: "grid", gap: 10 }}>
              {packet.attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  style={{
                    border: `1px solid ${BORDER}`,
                    borderRadius: 10,
                    padding: "12px 14px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 16,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ minWidth: 260, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 14, fontWeight: 800 }}>{attachment.label}</div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 800,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          borderRadius: 999,
                          padding: "4px 8px",
                          background: `${statusColor(attachment.status)}14`,
                          color: statusColor(attachment.status),
                        }}
                      >
                        {statusLabel(attachment.status)}
                      </span>
                    </div>
                    <div style={{ marginTop: 5, fontSize: 13, color: DIM }}>{attachment.note}</div>
                  </div>
                  {attachment.driveUrl ? (
                    <a
                      href={attachment.driveUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        color: NAVY,
                        fontSize: 13,
                        fontWeight: 700,
                        textDecoration: "none",
                      }}
                    >
                      Open in Drive ↗
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          </CardSection>

          <CardSection title="Item list / catalog" style={{ marginTop: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: DIM }}>
                This is the AP-facing item row to send with the Jungle Jim&apos;s packet.
              </div>
              <button
                onClick={downloadCsv}
                style={{
                  border: `1px solid ${NAVY}`,
                  borderRadius: 10,
                  background: NAVY,
                  color: "#fff",
                  padding: "8px 14px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Download CSV
              </button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: `${NAVY}08`, textAlign: "left" }}>
                    {[
                      "Item #",
                      "Description",
                      "Size",
                      "UPC",
                      "Case Pack",
                      "Case Cost",
                      "SRP",
                      "Min Order",
                    ].map((label) => (
                      <th
                        key={label}
                        style={{
                          padding: "10px 12px",
                          borderBottom: `1px solid ${BORDER}`,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {packet.catalog.map((item) => (
                    <tr key={item.vendorItemNumber}>
                      <td style={cellStyle}>{item.vendorItemNumber}</td>
                      <td style={cellStyle}>
                        <div style={{ fontWeight: 700 }}>{item.description}</div>
                        <div style={{ marginTop: 4, color: DIM }}>
                          Case UPC {item.caseUpc} · Master {item.masterCartonUpc}
                        </div>
                      </td>
                      <td style={cellStyle}>{item.size}</td>
                      <td style={cellStyle}>{item.unitUpc}</td>
                      <td style={cellStyle}>{item.casePack}</td>
                      <td style={cellStyle}>${item.caseCost.toFixed(2)}</td>
                      <td style={cellStyle}>{item.srpRange}</td>
                      <td style={cellStyle}>{item.minOrder}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {packet.catalog.map((item) => (
              <div key={`${item.vendorItemNumber}-note`} style={{ marginTop: 10, fontSize: 12, color: DIM }}>
                <strong>Source note:</strong> {item.sourceNote}
              </div>
            ))}
          </CardSection>

          <CardSection title="Reply draft" style={{ marginTop: 18 }}>
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: DIM }}>
                  Subject
                </div>
                <div style={{ marginTop: 4, fontSize: 14, fontWeight: 700 }}>{packet.replyDraft.subject}</div>
                <button
                  onClick={() => void handleCopy("reply-subject", packet.replyDraft.subject)}
                  style={copyButtonStyle}
                >
                  {copied === "reply-subject" ? "Copied" : "Copy subject"}
                </button>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: DIM }}>
                  Body
                </div>
                <pre
                  style={{
                    margin: "8px 0 0",
                    padding: "12px 14px",
                    borderRadius: 10,
                    border: `1px solid ${BORDER}`,
                    background: "#fcfbf8",
                    color: NAVY,
                    whiteSpace: "pre-wrap",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  {packet.replyDraft.body}
                </pre>
                <button
                  onClick={() => void handleCopy("reply-body", packet.replyDraft.body)}
                  style={copyButtonStyle}
                >
                  {copied === "reply-body" ? "Copied" : "Copy body"}
                </button>
              </div>
            </div>
          </CardSection>

          <CardSection title="Source trail" style={{ marginTop: 18 }}>
            <OrderedList items={packet.sources} />
          </CardSection>
        </>
      ) : null}
    </div>
  );
}

function HeaderCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: "14px 16px",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: DIM }}>
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 22, fontWeight: 800 }}>{value}</div>
      <div style={{ marginTop: 4, fontSize: 12, color: DIM }}>{hint}</div>
    </div>
  );
}

function CardSection({
  title,
  children,
  style,
}: {
  title: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 14,
        padding: "16px 18px",
        ...style,
      }}
    >
      <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 14 }}>{title}</div>
      {children}
    </section>
  );
}

function OrderedList({ items }: { items: string[] }) {
  return (
    <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 10, fontSize: 13, lineHeight: 1.55 }}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ol>
  );
}

function DefinitionGrid({
  rows,
  onCopy,
  copied,
}: {
  rows: Array<[string, string]>;
  onCopy: (key: string, value: string) => Promise<void>;
  copied: string | null;
}) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {rows.map(([label, value]) => (
        <div
          key={label}
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            padding: "10px 12px",
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: DIM }}>
              {label}
            </div>
            <div style={{ marginTop: 4, fontSize: 14, fontWeight: 700 }}>{value}</div>
          </div>
          <button onClick={() => void onCopy(label, value)} style={copyButtonStyle}>
            {copied === label ? "Copied" : "Copy"}
          </button>
        </div>
      ))}
    </div>
  );
}

const cellStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: `1px solid ${BORDER}`,
  verticalAlign: "top",
};

const copyButtonStyle: CSSProperties = {
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  background: "#fff",
  color: NAVY,
  padding: "7px 10px",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  marginTop: 8,
};

// ---------------------------------------------------------------------------
// Dashboard sections — added 2026-04-25 to surface every packet, not just JJ.
// All derivation goes through the pure helpers in
// `@/lib/ops/ap-packet-dashboard`, which are unit-tested for
// no-fabrication behavior. Send/resend stays gated behind the
// existing Class B `request-approval` route — this surface never
// fires Gmail directly.
// ---------------------------------------------------------------------------

const SEND_STATUS_COLOR: Record<string, string> = {
  not_yet_sent: GOLD,
  sent_recently: GREEN,
  sent_long_ago: AMBER,
  blocked_missing_docs: RED,
  blocked_pricing_review: AMBER,
};

function RosterSection(props: {
  roster: PacketRosterRow[];
  rosterErr: string | null;
  loading: boolean;
  activeSlug: string | null;
}) {
  const rows = useMemo<DashboardRow[]>(
    () => props.roster.map((r) => deriveDashboardRow(r)),
    [props.roster],
  );
  const summary = useMemo(() => summarizeDashboard(rows), [rows]);
  const templateRegistryWired = hasPacketTemplateRegistry();

  return (
    <section
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: "16px 18px",
        marginBottom: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <h2 style={{ color: GOLD, fontSize: 13, textTransform: "uppercase", margin: 0 }}>
          Packet roster
        </h2>
        <div style={{ fontSize: 12, color: DIM }}>
          {summary.total} total · {summary.notYetSent} not yet sent ·{" "}
          {summary.sentRecently} sent (recent) · {summary.sentLongAgo} stale ·{" "}
          {summary.blockedMissingDocs + summary.blockedPricingReview} blocked
        </div>
      </div>

      {props.rosterErr ? (
        <div
          style={{
            color: RED,
            fontSize: 12,
            marginBottom: 8,
          }}
        >
          Roster fetch error: {props.rosterErr}
        </div>
      ) : null}

      {props.loading && rows.length === 0 ? (
        <div style={{ color: DIM, fontSize: 12 }}>Loading roster…</div>
      ) : rows.length === 0 ? (
        <div
          style={{
            color: DIM,
            fontSize: 12,
            border: `1px dashed ${BORDER}`,
            borderRadius: 8,
            padding: "12px 14px",
          }}
        >
          No packets registered. Once `listApPackets()` returns more than the
          Jungle Jim&apos;s template, they&apos;ll appear here automatically.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: DIM, textAlign: "left" }}>
                <th style={rosterTh}>Account</th>
                <th style={rosterTh}>Owner</th>
                <th style={rosterTh}>Status</th>
                <th style={rosterTh}>Attachments</th>
                <th style={rosterTh}>Last sent</th>
                <th style={rosterTh}>Recommended next action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isActive = r.slug === props.activeSlug;
                return (
                  <tr
                    key={r.slug}
                    style={{
                      borderTop: `1px dashed ${BORDER}`,
                      background: isActive ? `${GOLD}15` : "transparent",
                    }}
                  >
                    <td style={rosterTd}>
                      <div style={{ fontWeight: 600 }}>{r.accountName}</div>
                      <div style={{ color: DIM, fontSize: 11 }}>
                        {r.apEmail} · slug `{r.slug}`
                      </div>
                    </td>
                    <td style={rosterTd}>{r.owner}</td>
                    <td style={rosterTd}>
                      <span
                        style={{
                          color: SEND_STATUS_COLOR[r.sendStatus] ?? DIM,
                          fontWeight: 600,
                        }}
                      >
                        {r.statusLabel}
                      </span>
                    </td>
                    <td style={rosterTd}>
                      <span style={{ color: GREEN }}>{r.attachmentSummary.ready} ready</span>
                      {r.attachmentSummary.missing > 0 ? (
                        <>
                          {" · "}
                          <span style={{ color: RED }}>
                            {r.attachmentSummary.missing} missing
                          </span>
                        </>
                      ) : null}
                      {r.attachmentSummary.review > 0 ? (
                        <>
                          {" · "}
                          <span style={{ color: AMBER }}>
                            {r.attachmentSummary.review} review
                          </span>
                        </>
                      ) : null}
                      {r.attachmentSummary.optional > 0 ? (
                        <>
                          {" · "}
                          <span style={{ color: DIM }}>
                            {r.attachmentSummary.optional} optional
                          </span>
                        </>
                      ) : null}
                    </td>
                    <td style={rosterTd}>
                      {r.lastSentAt ? (
                        <>
                          <div>{r.lastSentAt.slice(0, 10)}</div>
                          <div style={{ color: DIM, fontSize: 11 }}>
                            {r.lastSentBy ?? "—"}
                            {r.daysSinceLastSent !== null
                              ? ` · ${r.daysSinceLastSent}d ago`
                              : ""}
                          </div>
                        </>
                      ) : (
                        <span style={{ color: DIM }}>—</span>
                      )}
                    </td>
                    <td style={rosterTd}>
                      <div style={{ fontWeight: 600 }}>{r.recommendedAction}</div>
                      {r.secondaryActions.map((s) => (
                        <div key={s} style={{ color: DIM, fontSize: 11, marginTop: 2 }}>
                          {s}
                        </div>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div
        style={{
          marginTop: 12,
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {templateRegistryWired ? (
          <a href="#" style={{ color: GOLD, fontSize: 12, fontWeight: 600 }}>
            Create packet from template
          </a>
        ) : (
          <span
            style={{
              color: DIM,
              fontSize: 12,
              padding: "4px 8px",
              border: `1px dashed ${BORDER}`,
              borderRadius: 6,
            }}
            title="No template registry exists yet — add one in src/lib/ops/ap-packets.ts before wiring this button."
          >
            Create packet from template — not wired yet
          </span>
        )}
        <span style={{ color: DIM, fontSize: 11 }}>
          Send / resend goes through{" "}
          <code style={{ color: NAVY }}>
            POST /api/ops/fulfillment/ap-packet/request-approval
          </code>{" "}
          (Class B, Ben approves in Slack #ops-approvals). This page never sends
          email directly.
        </span>
      </div>
    </section>
  );
}

function PacketDetailHeader(props: {
  packet: ApPacket;
  lastSent: PacketResponse["lastSent"] | null;
}) {
  if (!props.lastSent) {
    return (
      <div
        style={{
          background: `${GOLD}10`,
          border: `1px solid ${GOLD}50`,
          color: NAVY,
          fontSize: 12,
          padding: "10px 14px",
          borderRadius: 10,
          marginBottom: 14,
        }}
      >
        <strong>{props.packet.accountName}</strong> packet has not been sent
        yet. Once Ben approves a Class B `gmail.send` for slug{" "}
        <code>{props.packet.slug}</code>, the send route stamps the
        `ap-packets:sent:&lt;slug&gt;` KV row and this banner flips to
        &quot;Sent&quot;.
      </div>
    );
  }
  return (
    <div
      style={{
        background: `${GREEN}10`,
        border: `1px solid ${GREEN}50`,
        color: NAVY,
        fontSize: 12,
        padding: "10px 14px",
        borderRadius: 10,
        marginBottom: 14,
      }}
    >
      <strong>{props.packet.accountName}</strong> packet sent on{" "}
      {props.lastSent.sentAt?.slice(0, 16)} by {props.lastSent.sentBy}
      {props.lastSent.messageId
        ? ` · Gmail message ${props.lastSent.messageId}`
        : ""}
      {props.lastSent.threadId ? ` · thread ${props.lastSent.threadId}` : ""}.
      To resend, open a new Class B approval at{" "}
      <code>POST /api/ops/fulfillment/ap-packet/request-approval</code>.
    </div>
  );
}

const rosterTh: CSSProperties = {
  padding: "6px 10px",
  fontWeight: 600,
};
const rosterTd: CSSProperties = {
  padding: "8px 10px",
  verticalAlign: "top",
};
