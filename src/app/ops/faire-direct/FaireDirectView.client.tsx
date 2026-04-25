"use client";

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

type FaireInviteStatus = "needs_review" | "approved" | "sent" | "rejected";

interface InviteRecord {
  id: string;
  retailerName: string;
  buyerName?: string;
  email: string;
  city?: string;
  state?: string;
  source: string;
  notes?: string;
  hubspotContactId?: string;
  status: FaireInviteStatus;
  queuedAt: string;
  updatedAt: string;
}

interface InvitesResponse {
  ok: boolean;
  degraded: boolean;
  degradedReason: string | null;
  totals: {
    needs_review: number;
    approved: number;
    sent: number;
    rejected: number;
    total: number;
  };
  invites: {
    needs_review: InviteRecord[];
    approved: InviteRecord[];
    sent: InviteRecord[];
    rejected: InviteRecord[];
  };
}

const STATUS_COLOR: Record<FaireInviteStatus, string> = {
  needs_review: AMBER,
  approved: GREEN,
  sent: NAVY,
  rejected: RED,
};

export function FaireDirectView() {
  const [data, setData] = useState<InvitesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/ops/faire/direct-invites", {
          cache: "no-store",
        });
        const body = (await res.json().catch(() => ({}))) as
          | InvitesResponse
          | { error?: string };
        if (cancelled) return;
        if (!res.ok || (body as InvitesResponse).ok !== true) {
          setError(
            (body as { error?: string }).error ?? `HTTP ${res.status}`,
          );
          setData(null);
        } else {
          setData(body as InvitesResponse);
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
  }, []);

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
          Internal · Faire Direct invite queue
        </div>
        <h1 style={{ color: NAVY, fontSize: 26, margin: "4px 0 0 0" }}>
          Faire Direct — invite candidates
        </h1>
        <p style={{ color: DIM, fontSize: 13, marginTop: 4 }}>
          <strong>Review queue only — no emails or Faire invites are sent
          from this page.</strong> Each candidate becomes a Class B{" "}
          <code>faire-direct.invite</code> approval when Ben/Rene chooses to
          dispatch it (a future Phase 2 build). Phase 1 just stages and
          reviews.
        </p>
      </header>

      {data?.degraded && (
        <div
          style={{
            background: `${AMBER}15`,
            border: `1px solid ${AMBER}50`,
            borderRadius: 8,
            padding: "10px 12px",
            color: AMBER,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          <strong>Faire API not configured.</strong>{" "}
          {data.degradedReason ??
            "FAIRE_ACCESS_TOKEN is not set. Queue staging works; send-on-approve unavailable until the token lands."}
        </div>
      )}

      {error && (
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
          Queue fetch error: {error}
        </div>
      )}

      {loading && !data && (
        <div style={{ color: DIM, fontSize: 13 }}>Loading queue…</div>
      )}

      {data && (
        <>
          <section
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              borderRadius: 10,
              padding: "12px 16px",
              marginBottom: 16,
              display: "flex",
              gap: 24,
              flexWrap: "wrap",
              fontSize: 13,
            }}
          >
            <span>
              Total invites: <strong>{data.totals.total}</strong>
            </span>
            <span style={{ color: STATUS_COLOR.needs_review }}>
              Needs review: <strong>{data.totals.needs_review}</strong>
            </span>
            <span style={{ color: STATUS_COLOR.approved }}>
              Approved: <strong>{data.totals.approved}</strong>
            </span>
            <span style={{ color: STATUS_COLOR.sent }}>
              Sent: <strong>{data.totals.sent}</strong>
            </span>
            <span style={{ color: STATUS_COLOR.rejected }}>
              Rejected: <strong>{data.totals.rejected}</strong>
            </span>
          </section>

          <InviteTable
            title="Needs review"
            invites={data.invites.needs_review}
            color={STATUS_COLOR.needs_review}
          />
          <InviteTable
            title="Approved (awaiting Phase 2 send-on-approve)"
            invites={data.invites.approved}
            color={STATUS_COLOR.approved}
            note="No email is sent until Phase 2 wires the Class B faire-direct.invite approval click to the actual Faire invite path."
          />
          <InviteTable
            title="Sent"
            invites={data.invites.sent}
            color={STATUS_COLOR.sent}
          />
          <InviteTable
            title="Rejected"
            invites={data.invites.rejected}
            color={STATUS_COLOR.rejected}
          />
        </>
      )}

      <p style={{ fontSize: 11, color: DIM, marginTop: 22 }}>
        This page is read-only. Staging happens via{" "}
        <code>POST /api/ops/faire/direct-invites</code>. No Gmail, no Faire
        API write, no Slack post happens from this surface.
      </p>
    </div>
  );
}

function InviteTable(props: {
  title: string;
  invites: InviteRecord[];
  color: string;
  note?: string;
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
        }}
      >
        <h2
          style={{
            color: props.color,
            fontSize: 13,
            textTransform: "uppercase",
            margin: 0,
          }}
        >
          {props.title}
        </h2>
        <span style={{ fontSize: 12, color: DIM }}>
          {props.invites.length}{" "}
          {props.invites.length === 1 ? "candidate" : "candidates"}
        </span>
      </div>
      {props.invites.length === 0 ? (
        <div style={{ fontSize: 12, color: DIM }}>(empty)</div>
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
                <Th>Retailer</Th>
                <Th>Buyer</Th>
                <Th>Email</Th>
                <Th>Location</Th>
                <Th>Source</Th>
                <Th>Queued</Th>
              </tr>
            </thead>
            <tbody>
              {props.invites.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px dashed ${BORDER}` }}>
                  <Td>
                    <div style={{ fontWeight: 600 }}>{r.retailerName}</div>
                    {r.notes && (
                      <div
                        style={{ color: DIM, fontSize: 11, marginTop: 2 }}
                      >
                        {r.notes.length > 80
                          ? `${r.notes.slice(0, 80)}…`
                          : r.notes}
                      </div>
                    )}
                  </Td>
                  <Td>{r.buyerName ?? "—"}</Td>
                  <Td>
                    <code>{r.email}</code>
                  </Td>
                  <Td>
                    {r.city || r.state
                      ? `${r.city ?? ""}${r.city && r.state ? ", " : ""}${r.state ?? ""}`
                      : "—"}
                  </Td>
                  <Td style={{ color: DIM }}>{r.source}</Td>
                  <Td style={{ color: DIM }}>
                    {r.queuedAt?.slice(0, 10)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {props.note && (
        <p style={{ fontSize: 11, color: DIM, marginTop: 8 }}>{props.note}</p>
      )}
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "6px 10px", fontWeight: 600 }}>{children}</th>;
}
function Td({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return <td style={{ padding: "6px 10px", ...style }}>{children}</td>;
}
