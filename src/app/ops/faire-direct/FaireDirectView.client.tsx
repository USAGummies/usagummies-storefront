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
  directLinkUrl?: string;
  status: FaireInviteStatus;
  queuedAt: string;
  updatedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
  sentAt?: string;
  sentBy?: string;
  gmailMessageId?: string;
  sentApprovalId?: string;
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
          Approve a candidate, paste the brand-portal Faire Direct link URL,
          then click <strong>Request send approval</strong> to open a Class B{" "}
          <code>faire-direct.invite</code> approval card in Slack. Ben&apos;s
          click in <code>#ops-approvals</code> drives the actual Gmail send —
          no Faire API call ever happens, and no email goes out from this page
          directly.
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
            title="Approved — ready to request send approval"
            invites={data.invites.approved}
            color={STATUS_COLOR.approved}
            note="An approved row with a valid directLinkUrl is eligible for a Class B send approval. Click 'Request send approval' to open the Slack card; Ben's click drives the Gmail send via the slack approval handler."
            onUpdated={refresh}
          />
          <InviteTable
            title="Sent"
            invites={data.invites.sent}
            color={STATUS_COLOR.sent}
            onUpdated={refresh}
            note="Set only by the faire-direct.invite send closer after a successful Gmail send. Read-only here."
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
        Staging happens via{" "}
        <code>POST /api/ops/faire/direct-invites</code>. The send happens only
        after a Class B approval is opened (
        <code>POST /api/ops/faire/direct-invites/&lt;id&gt;/request-approval</code>
        ) and Ben clicks approve in <code>#ops-approvals</code>. The Faire API
        is never called by this workflow.
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

function isLikelyValidUrl(value: string): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
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
  const [link, setLink] = useState<string>(invite.directLinkUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [approvalInfo, setApprovalInfo] = useState<{
    approvalId: string;
    slackThread?: { channel: string; ts: string } | null;
  } | null>(null);

  const linkChanged = link.trim() !== (invite.directLinkUrl ?? "").trim();
  const statusChanged = invite.status !== "sent" && status !== invite.status;
  const noteChanged = note.trim() !== (invite.reviewNote ?? "").trim();
  const dirty = statusChanged || noteChanged || linkChanged;

  async function save() {
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const body: Record<string, unknown> = {};
      if (statusChanged) body.status = status;
      if (noteChanged) body.reviewNote = note.trim();
      if (linkChanged) {
        body.fieldCorrections = { directLinkUrl: link.trim() };
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

  async function requestSendApproval() {
    setRequesting(true);
    setError(null);
    setApprovalInfo(null);
    try {
      const res = await fetch(
        `/api/ops/faire/direct-invites/${encodeURIComponent(invite.id)}/request-approval`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        code?: string;
        approvalId?: string;
        slackThread?: { channel: string; ts: string } | null;
      };
      if (!res.ok || data.ok !== true) {
        setError(
          data.error ??
            `Approval request failed (HTTP ${res.status}${data.code ? `, code ${data.code}` : ""}).`,
        );
        return;
      }
      setApprovalInfo({
        approvalId: data.approvalId ?? "(unknown)",
        slackThread: data.slackThread ?? null,
      });
      props.onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRequesting(false);
    }
  }

  const isSent = invite.status === "sent";
  const isApproved = invite.status === "approved";
  const linkPersisted = (invite.directLinkUrl ?? "").trim().length > 0;
  const linkValidLocally = isLikelyValidUrl(link.trim());
  const canRequestApproval =
    isApproved &&
    linkPersisted &&
    isLikelyValidUrl(invite.directLinkUrl ?? "") &&
    !linkChanged && // require save first if dirty — we don't want to request on a stale row
    !statusChanged &&
    !noteChanged;
  const approvalBlockedReason = (() => {
    if (!isApproved) return "Move status to approved first.";
    if (!linkPersisted) return "Paste the Faire Direct link URL and Save it first.";
    if (!isLikelyValidUrl(invite.directLinkUrl ?? "")) {
      return "Saved link URL doesn't look like a valid http(s) URL.";
    }
    if (linkChanged || statusChanged || noteChanged) {
      return "Save pending changes before requesting approval.";
    }
    return null;
  })();

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
          {invite.directLinkUrl && (
            <div
              style={{
                color: DIM,
                fontSize: 11,
                marginTop: 4,
                wordBreak: "break-all",
              }}
            >
              <em>Faire Direct link:</em>{" "}
              <a
                href={invite.directLinkUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: NAVY }}
              >
                {invite.directLinkUrl}
              </a>
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
            Faire Direct link URL (paste from brand portal)
            <input
              type="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              disabled={saving || isSent}
              placeholder="https://faire.com/..."
              maxLength={2048}
              style={{
                padding: "6px 8px",
                fontSize: 12,
                border: `1px solid ${
                  link.length > 0 && !linkValidLocally ? RED : BORDER
                }`,
                borderRadius: 6,
                background: isSent ? BG : "#fff",
                fontFamily: "monospace",
              }}
            />
            <span style={{ fontSize: 10, color: DIM, marginTop: 2 }}>
              Required before approval. The closer drops this URL into the
              Gmail body verbatim — never edit it after sending.
            </span>
          </label>
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
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={save}
              disabled={!dirty || saving || isSent}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                background: NAVY,
                color: "#fff",
                border: 0,
                borderRadius: 6,
                cursor:
                  !dirty || saving || isSent ? "not-allowed" : "pointer",
                opacity: !dirty || saving || isSent ? 0.5 : 1,
              }}
            >
              {saving ? "Saving…" : "Save review"}
            </button>
            {!isSent && (
              <button
                onClick={requestSendApproval}
                disabled={!canRequestApproval || requesting}
                title={
                  approvalBlockedReason ??
                  "Open a Class B faire-direct.invite approval card in #ops-approvals."
                }
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  background: GOLD,
                  color: NAVY,
                  border: 0,
                  borderRadius: 6,
                  cursor:
                    !canRequestApproval || requesting
                      ? "not-allowed"
                      : "pointer",
                  opacity:
                    !canRequestApproval || requesting ? 0.5 : 1,
                  fontWeight: 600,
                }}
              >
                {requesting ? "Opening approval…" : "Request send approval"}
              </button>
            )}
            {savedAt && (
              <span style={{ fontSize: 11, color: GREEN }}>
                Saved {savedAt}
              </span>
            )}
            {error && (
              <span style={{ fontSize: 11, color: RED }}>{error}</span>
            )}
          </div>
          {!isSent && approvalBlockedReason && (
            <div style={{ fontSize: 10, color: DIM, marginTop: -2 }}>
              <em>{approvalBlockedReason}</em>
            </div>
          )}
          {approvalInfo && (
            <div
              style={{
                fontSize: 11,
                color: GREEN,
                background: `${GREEN}10`,
                border: `1px solid ${GREEN}40`,
                borderRadius: 6,
                padding: "6px 8px",
                marginTop: 4,
              }}
            >
              Approval opened — id <code>{approvalInfo.approvalId}</code>.
              {approvalInfo.slackThread
                ? " Slack card posted to #ops-approvals — wait for Ben's click to drive the send."
                : " Approval stored, but Slack post may have failed — check #ops-audit."}
            </div>
          )}
          {isSent && (
            <div
              style={{
                fontSize: 11,
                color: NAVY,
                background: `${NAVY}10`,
                border: `1px solid ${NAVY}30`,
                borderRadius: 6,
                padding: "6px 8px",
              }}
            >
              <strong>Sent</strong>
              {invite.sentAt
                ? ` ${invite.sentAt.slice(0, 16)}`
                : ""}
              {invite.sentBy ? ` by ${invite.sentBy}` : ""}.
              {invite.gmailMessageId && (
                <>
                  {" "}
                  Gmail message <code>{invite.gmailMessageId}</code>.
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
