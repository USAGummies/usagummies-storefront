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

type PacketResponse = {
  ok: boolean;
  packet?: ApPacket;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ops/ap-packets?account=jungle-jims", {
        cache: "no-store",
      });
      const data = (await res.json()) as PacketResponse;
      if (!res.ok || !data.packet) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setPacket(data.packet);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPacket(null);
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

      {!loading && packet ? (
        <>
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
