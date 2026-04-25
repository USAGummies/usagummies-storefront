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
  drafts?: ApPacketDraftSummary[];
  counts?: {
    live: number;
    drafts: number;
    draftsIncomplete: number;
  };
  error?: string;
};

type ApPacketDraftSummary = {
  slug: string;
  templateSlug: string;
  lifecycle: "draft";
  accountName: string;
  apEmail: string;
  owner: string;
  dueWindow: string;
  createdAt: string;
  requiredFieldsComplete: boolean;
  missingRequired: string[];
};

type TemplateOption = {
  slug: string;
  label: string;
  purpose: string;
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
  const [drafts, setDrafts] = useState<ApPacketDraftSummary[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);

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
          setDrafts(Array.isArray(rosterData.drafts) ? rosterData.drafts : []);
          setRosterErr(null);
        } else {
          setRoster([]);
          setDrafts([]);
          setRosterErr(rosterData.error || `Roster HTTP ${rosterRes.status}`);
        }
      } catch (err) {
        setRoster([]);
        setDrafts([]);
        setRosterErr(err instanceof Error ? err.message : String(err));
      }

      // Templates — separate fetch keeps the create-from-template
      // form's options decoupled from the roster shape.
      try {
        const tmplRes = await fetch("/api/ops/ap-packets/drafts", {
          cache: "no-store",
        });
        const tmplData = (await tmplRes.json()) as {
          ok: boolean;
          templates?: TemplateOption[];
        };
        if (tmplRes.ok && Array.isArray(tmplData.templates)) {
          setTemplates(tmplData.templates);
        }
      } catch {
        // Non-fatal — the form just falls back to a single hardcoded
        // option in the dropdown.
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

      <DraftsSection
        drafts={drafts}
        templates={templates}
        loading={loading}
        onCreated={() => void load()}
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
          <a
            href="#draft-creator"
            style={{ color: GOLD, fontSize: 12, fontWeight: 600 }}
          >
            Create packet from template ↓
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

// ---------------------------------------------------------------------------
// Drafts section — added 2026-04-26 with the template registry build.
//
// Shows drafts created from `usa-gummies-base` etc. Drafts are NEVER
// sendable — they live in their own KV store and the live `getApPacket()`
// (which the send route uses) returns null for any draft slug. To send
// a draft, the operator must first promote it to a live packet via a
// future flow (not built yet).
// ---------------------------------------------------------------------------

function DraftsSection(props: {
  drafts: ApPacketDraftSummary[];
  templates: TemplateOption[];
  loading: boolean;
  onCreated: () => void;
}) {
  const [slug, setSlug] = useState("");
  const [accountName, setAccountName] = useState("");
  const [apEmail, setApEmail] = useState("");
  const [templateSlug, setTemplateSlug] = useState<string>("");
  const [owner, setOwner] = useState("Rene Gonzalez");
  const [dueWindow, setDueWindow] = useState(
    "Return packet within 5 business days",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successSlug, setSuccessSlug] = useState<string | null>(null);

  // Default the template to the first registered one (today: usa-gummies-base).
  if (templateSlug === "" && props.templates.length > 0) {
    setTemplateSlug(props.templates[0].slug);
  }

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitting(true);
      setError(null);
      setSuccessSlug(null);
      try {
        const res = await fetch("/api/ops/ap-packets/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug: slug.trim(),
            templateSlug,
            accountName: accountName.trim(),
            apEmail: apEmail.trim(),
            owner: owner.trim() || undefined,
            dueWindow: dueWindow.trim() || undefined,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          issues?: string[];
          draft?: { slug: string };
        };
        if (!res.ok || body.ok !== true) {
          setError(
            body.error ||
              `HTTP ${res.status}` +
                (body.issues?.length ? `: ${body.issues.join("; ")}` : ""),
          );
          return;
        }
        setSuccessSlug(body.draft?.slug ?? slug.trim());
        setSlug("");
        setAccountName("");
        setApEmail("");
        // Don't reset owner / dueWindow / templateSlug — operator
        // probably wants to create more from the same template.
        props.onCreated();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    },
    [
      slug,
      templateSlug,
      accountName,
      apEmail,
      owner,
      dueWindow,
      props,
    ],
  );

  const incompleteCount = props.drafts.filter(
    (d) => !d.requiredFieldsComplete,
  ).length;

  return (
    <section
      id="draft-creator"
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
        <h2
          style={{
            color: GOLD,
            fontSize: 13,
            textTransform: "uppercase",
            margin: 0,
          }}
        >
          Drafts (template-built)
        </h2>
        <div style={{ fontSize: 12, color: DIM }}>
          {props.drafts.length} total · {incompleteCount} incomplete · drafts
          cannot be sent until promoted to live
        </div>
      </div>

      {/* Drafts roster */}
      {props.drafts.length === 0 ? (
        <div
          style={{
            color: DIM,
            fontSize: 12,
            border: `1px dashed ${BORDER}`,
            borderRadius: 8,
            padding: "12px 14px",
            marginBottom: 12,
          }}
        >
          No drafts yet. Use the form below to create one from a template.
        </div>
      ) : (
        <div style={{ overflowX: "auto", marginBottom: 14 }}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
          >
            <thead>
              <tr style={{ color: DIM, textAlign: "left" }}>
                <th style={rosterTh}>Account</th>
                <th style={rosterTh}>Slug</th>
                <th style={rosterTh}>Owner</th>
                <th style={rosterTh}>Template</th>
                <th style={rosterTh}>Status</th>
                <th style={rosterTh}>Missing</th>
                <th style={rosterTh}>Created</th>
              </tr>
            </thead>
            <tbody>
              {props.drafts.map((d) => (
                <tr
                  key={d.slug}
                  style={{ borderTop: `1px dashed ${BORDER}` }}
                >
                  <td style={rosterTd}>
                    <div style={{ fontWeight: 600 }}>{d.accountName}</div>
                    <div style={{ color: DIM, fontSize: 11 }}>{d.apEmail}</div>
                  </td>
                  <td style={rosterTd}>
                    <code>{d.slug}</code>
                  </td>
                  <td style={rosterTd}>{d.owner}</td>
                  <td style={rosterTd} title={d.templateSlug}>
                    <code style={{ fontSize: 11 }}>{d.templateSlug}</code>
                  </td>
                  <td style={rosterTd}>
                    {d.requiredFieldsComplete ? (
                      <span style={{ color: GREEN, fontWeight: 600 }}>
                        DRAFT — COMPLETE
                      </span>
                    ) : (
                      <span style={{ color: AMBER, fontWeight: 600 }}>
                        DRAFT — INCOMPLETE
                      </span>
                    )}
                  </td>
                  <td style={rosterTd}>
                    {d.missingRequired.length > 0 ? (
                      <span style={{ color: RED, fontSize: 11 }}>
                        {d.missingRequired.join(", ")}
                      </span>
                    ) : (
                      <span style={{ color: DIM }}>—</span>
                    )}
                  </td>
                  <td style={rosterTd}>
                    <span style={{ color: DIM }}>
                      {d.createdAt?.slice(0, 16)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create-from-template form */}
      <form
        onSubmit={submit}
        style={{
          background: "#fff",
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          padding: "12px 14px",
        }}
      >
        <div style={{ fontSize: 12, color: DIM, marginBottom: 10 }}>
          Create a new packet draft from a template. Stored in KV only — no
          email, no QBO write, no Drive write. Drafts cannot be sent.
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 10,
          }}
        >
          <Field label="Slug (kebab-case)">
            <input
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="whole-foods"
              style={inputStyle}
              disabled={submitting}
            />
          </Field>
          <Field label="Account name">
            <input
              required
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="Whole Foods Market"
              style={inputStyle}
              disabled={submitting}
            />
          </Field>
          <Field label="AP email">
            <input
              required
              type="email"
              value={apEmail}
              onChange={(e) => setApEmail(e.target.value)}
              placeholder="vendorsetup@wholefoods.com"
              style={inputStyle}
              disabled={submitting}
            />
          </Field>
          <Field label="Template">
            <select
              value={templateSlug}
              onChange={(e) => setTemplateSlug(e.target.value)}
              style={inputStyle}
              disabled={submitting || props.templates.length === 0}
            >
              {props.templates.length === 0 ? (
                <option value="">(loading templates…)</option>
              ) : (
                props.templates.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.label}
                  </option>
                ))
              )}
            </select>
          </Field>
          <Field label="Owner">
            <input
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              style={inputStyle}
              disabled={submitting}
            />
          </Field>
          <Field label="Due window">
            <input
              value={dueWindow}
              onChange={(e) => setDueWindow(e.target.value)}
              style={inputStyle}
              disabled={submitting}
            />
          </Field>
        </div>
        <div
          style={{
            marginTop: 12,
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <button
            type="submit"
            disabled={submitting || !templateSlug}
            style={{
              background: NAVY,
              color: "#fff",
              border: 0,
              borderRadius: 6,
              padding: "8px 14px",
              fontSize: 13,
              cursor: submitting ? "wait" : "pointer",
            }}
          >
            {submitting ? "Creating…" : "Create draft"}
          </button>
          {error && (
            <span style={{ color: RED, fontSize: 12 }}>{error}</span>
          )}
          {successSlug && !error && (
            <span style={{ color: GREEN, fontSize: 12 }}>
              Draft <code>{successSlug}</code> created. It&apos;s in the table
              above — fill in the missing attachments next.
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", fontSize: 12, color: DIM }}>
      <div style={{ marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  );
}

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: `1px solid ${BORDER}`,
  borderRadius: 6,
  fontSize: 13,
  background: "#fff",
};
