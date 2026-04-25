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
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
}

type ReviewableStatus = Exclude<FaireInviteStatus, "sent">;

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
  const [refreshTick, setRefreshTick] = useState(0);

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
  }, [refreshTick]);

  const refresh = () => setRefreshTick((n) => n + 1);

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
            onUpdated={refresh}
          />
          <InviteTable
            title="Approved (ready for a future Class B send approval, not sent)"
            invites={data.invites.approved}
            color={STATUS_COLOR.approved}
            note="Approved means ready for a future Class B send approval, not sent. The send closer doesn't exist yet — no Faire invite goes out from this surface."
            onUpdated={refresh}
          />
          <InviteTable
            title="Sent"
            invites={data.invites.sent}
            color={STATUS_COLOR.sent}
            onUpdated={refresh}
            note="Set only by the future faire-direct.invite send closer. Cannot be set from this review page."
          />
          <InviteTable
            title="Rejected"
            invites={data.invites.rejected}
            color={STATUS_COLOR.rejected}
            onUpdated={refresh}
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
  onUpdated: () => void;
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
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {props.invites.map((r) => (
            <InviteCard key={r.id} invite={r} onUpdated={props.onUpdated} />
          ))}
        </ul>
      )}
      {props.note && (
        <p style={{ fontSize: 11, color: DIM, marginTop: 8 }}>{props.note}</p>
      )}
    </section>
  );
}

function InviteCard(props: {
  invite: InviteRecord;
  onUpdated: () => void;
}) {
  const { invite } = props;
  // The dropdown intentionally excludes "sent". The route also rejects
  // status="sent" with HTTP 422 sent_status_forbidden, so even if a
  // future change adds the option, the server is still the source of
  // truth for the lifecycle gate.
  const initialStatus: ReviewableStatus =
    invite.status === "sent" ? "approved" : invite.status;
  const [status, setStatus] = useState<ReviewableStatus>(initialStatus);
  const [note, setNote] = useState<string>(invite.reviewNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const dirty =
    (invite.status !== "sent" && status !== invite.status) ||
    note.trim() !== (invite.reviewNote ?? "").trim();

  async function save() {
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const body: Record<string, unknown> = {};
      if (invite.status !== "sent" && status !== invite.status) {
        body.status = status;
      }
      if (note.trim() !== (invite.reviewNote ?? "").trim()) {
        body.reviewNote = note.trim();
      }
      if (Object.keys(body).length === 0) {
        setError("Nothing to save.");
        setSaving(false);
        return;
      }
      const res = await fetch(
        `/api/ops/faire/direct-invites/${encodeURIComponent(invite.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        code?: string;
      };
      if (!res.ok || data.ok !== true) {
        setError(
          data.error ??
            `Save failed (HTTP ${res.status}${data.code ? `, code ${data.code}` : ""}).`,
        );
        setSaving(false);
        return;
      }
      setSavedAt(new Date().toLocaleTimeString("en-US"));
      props.onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const isSent = invite.status === "sent";

  return (
    <li style={{ borderTop: `1px dashed ${BORDER}`, padding: "10px 4px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div>
          <div style={{ fontWeight: 600 }}>{invite.retailerName}</div>
          <div style={{ color: DIM, fontSize: 11, marginTop: 2 }}>
            <code>{invite.email}</code>
            {invite.buyerName ? ` · ${invite.buyerName}` : ""}
          </div>
          <div style={{ color: DIM, fontSize: 12, marginTop: 4 }}>
            {invite.city || invite.state
              ? `${invite.city ?? ""}${invite.city && invite.state ? ", " : ""}${invite.state ?? ""} · `
              : ""}
            source <code>{invite.source}</code>
          </div>
          <div style={{ color: DIM, fontSize: 11, marginTop: 2 }}>
            Queued {invite.queuedAt?.slice(0, 10)}
            {invite.reviewedAt
              ? ` · Last reviewed ${invite.reviewedAt.slice(0, 16)}${
                  invite.reviewedBy ? ` by ${invite.reviewedBy}` : ""
                }`
              : ""}
          </div>
          {invite.notes && (
            <div style={{ color: DIM, fontSize: 11, marginTop: 4 }}>
              <em>Source notes:</em> {invite.notes}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {isSent ? (
            <div
              style={{
                fontSize: 11,
                color: DIM,
                background: BG,
                border: `1px dashed ${BORDER}`,
                borderRadius: 6,
                padding: "8px 10px",
              }}
            >
              Status: <strong>sent</strong> (terminal). Use the future
              send closer to roll back if needed.
            </div>
          ) : (
            <label
              style={{
                fontSize: 11,
                color: DIM,
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              Status
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as ReviewableStatus)
                }
                disabled={saving}
                style={{
                  padding: "6px 8px",
                  fontSize: 12,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 6,
                  background: "#fff",
                }}
              >
                <option value="needs_review">needs_review</option>
                <option value="approved">approved</option>
                <option value="rejected">rejected</option>
              </select>
            </label>
          )}
          <label
            style={{
              fontSize: 11,
              color: DIM,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            Review note (optional)
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={saving}
              rows={2}
              maxLength={1000}
              style={{
                padding: "6px 8px",
                fontSize: 12,
                border: `1px solid ${BORDER}`,
                borderRadius: 6,
                background: "#fff",
                resize: "vertical",
              }}
            />
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={save}
              disabled={!dirty || saving}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                background: NAVY,
                color: "#fff",
                border: 0,
                borderRadius: 6,
                cursor: !dirty || saving ? "not-allowed" : "pointer",
                opacity: !dirty || saving ? 0.5 : 1,
              }}
            >
              {saving ? "Saving…" : "Save review"}
            </button>
            {savedAt && (
              <span style={{ fontSize: 11, color: GREEN }}>
                Saved {savedAt}
              </span>
            )}
            {error && (
              <span style={{ fontSize: 11, color: RED }}>{error}</span>
            )}
          </div>
        </div>
      </div>
    </li>
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
