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

          <FollowUpSection refreshTick={refreshTick} />

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

// ---------------------------------------------------------------------------
// Follow-up section
// ---------------------------------------------------------------------------
//
// Surfaces sent invites that have crossed the 3-day "due soon" or
// 7-day "overdue" threshold without a follow-up being queued. As of
// Phase 3.3 each actionable card carries a **Request follow-up
// approval** button that opens a Class B `faire-direct.follow-up`
// approval card in #ops-approvals. Ben's click in Slack drives the
// actual Gmail send via `executeApprovedFaireDirectFollowUp` (chain
// step 6 in `/api/slack/approvals`). No follow-up email is ever sent
// from this surface directly.

interface FollowUpRow {
  id: string;
  retailerName: string;
  buyerName?: string;
  email: string;
  source: string;
  notes?: string;
  hubspotContactId?: string;
  sentAt?: string;
  sentBy?: string;
  gmailMessageId?: string;
  daysSinceSent: number | null;
  bucket: "overdue" | "due_soon" | "not_due";
  reason: { code: string; detail: string };
  suggestedAction: string | null;
  // Phase 3.3 — follow-up lifecycle metadata. The route surfaces these
  // on every row (actionable or not) so the UI can show "queued" /
  // "sent" badges without a second round-trip.
  followUpQueuedAt?: string;
  followUpRequestApprovalId?: string;
  followUpSentAt?: string;
  followUpSentBy?: string;
  followUpGmailMessageId?: string;
}

interface FollowUpResponse {
  ok: boolean;
  now: string;
  totals: {
    overdue: number;
    due_soon: number;
    not_due: number;
    total: number;
    sent_total: number;
  };
  overdue: FollowUpRow[];
  due_soon: FollowUpRow[];
  not_due: FollowUpRow[];
}

function FollowUpSection({ refreshTick }: { refreshTick: number }) {
  const [data, setData] = useState<FollowUpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          "/api/ops/faire/direct-invites/follow-ups",
          { cache: "no-store" },
        );
        const body = (await res.json().catch(() => ({}))) as
          | FollowUpResponse
          | { error?: string };
        if (cancelled) return;
        if (!res.ok || (body as FollowUpResponse).ok !== true) {
          setError(
            (body as { error?: string }).error ?? `HTTP ${res.status}`,
          );
          setData(null);
        } else {
          setData(body as FollowUpResponse);
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
  }, [refreshTick, localRefresh]);

  const refreshLocal = () => setLocalRefresh((n) => n + 1);

  if (loading && !data) {
    return (
      <section
        style={{
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          padding: "12px 16px",
          marginBottom: 14,
          fontSize: 12,
          color: DIM,
        }}
      >
        Loading follow-up queue…
      </section>
    );
  }
  if (error) {
    return (
      <section
        style={{
          background: `${RED}10`,
          border: `1px solid ${RED}40`,
          borderRadius: 8,
          padding: "10px 12px",
          color: RED,
          fontSize: 13,
          marginBottom: 14,
        }}
      >
        Follow-up queue error: {error}
      </section>
    );
  }
  if (!data) return null;

  const actionable = data.overdue.length + data.due_soon.length;

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
          flexWrap: "wrap",
        }}
      >
        <h2
          style={{
            color: NAVY,
            fontSize: 13,
            textTransform: "uppercase",
            margin: 0,
          }}
        >
          Follow-up queue
        </h2>
        <span style={{ fontSize: 12, color: DIM }}>
          {actionable === 0
            ? `No invites need follow-up · ${data.totals.sent_total} total sent`
            : `${actionable} need follow-up · ${data.totals.sent_total} total sent`}
        </span>
      </div>
      <p style={{ fontSize: 11, color: DIM, margin: "0 0 10px 0" }}>
        Sent invites past the 3-day &ldquo;due soon&rdquo; or 7-day
        &ldquo;overdue&rdquo; threshold. Click <strong>Request follow-up
        approval</strong> to open a Class B{" "}
        <code>faire-direct.follow-up</code> approval card in{" "}
        <code>#ops-approvals</code>; Ben&apos;s click in Slack drives the
        Gmail send. No follow-up email is ever sent from this surface
        directly.
      </p>
      <FollowUpBucket
        title="Overdue (≥7 days)"
        rows={data.overdue}
        color={RED}
        emptyText="(no overdue follow-ups)"
        onUpdated={refreshLocal}
      />
      <FollowUpBucket
        title="Due soon (3–6 days)"
        rows={data.due_soon}
        color={AMBER}
        emptyText="(no follow-ups due soon)"
        onUpdated={refreshLocal}
      />
    </section>
  );
}

function FollowUpBucket(props: {
  title: string;
  rows: FollowUpRow[];
  color: string;
  emptyText: string;
  onUpdated: () => void;
}) {
  return (
    <div style={{ marginTop: 8 }}>
      <div
        style={{
          color: props.color,
          fontSize: 12,
          textTransform: "uppercase",
          fontWeight: 600,
          letterSpacing: 0.3,
          marginBottom: 4,
        }}
      >
        {props.title} · {props.rows.length}
      </div>
      {props.rows.length === 0 ? (
        <div style={{ fontSize: 12, color: DIM, paddingLeft: 6 }}>
          {props.emptyText}
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {props.rows.map((row) => (
            <FollowUpCard
              key={row.id}
              row={row}
              color={props.color}
              onUpdated={props.onUpdated}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FollowUpCard({
  row,
  color,
  onUpdated,
}: {
  row: FollowUpRow;
  color: string;
  onUpdated: () => void;
}) {
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvalInfo, setApprovalInfo] = useState<{
    approvalId: string;
    slackThread?: { channel: string; ts: string } | null;
  } | null>(null);

  const isQueued = Boolean(row.followUpQueuedAt);
  const isSent = Boolean(row.followUpSentAt);
  // Disable Request when already queued/sent or while a request is
  // in flight. The route also re-checks all of these server-side.
  const canRequest = !isQueued && !isSent && !requesting;

  async function requestFollowUp() {
    setRequesting(true);
    setError(null);
    setApprovalInfo(null);
    try {
      const res = await fetch(
        `/api/ops/faire/direct-invites/${encodeURIComponent(row.id)}/follow-up/request-approval`,
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
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRequesting(false);
    }
  }

  return (
    <li
      style={{
        borderTop: `1px dashed ${BORDER}`,
        padding: "8px 4px",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr",
          gap: 14,
          alignItems: "start",
        }}
      >
        <div>
          <div style={{ fontWeight: 600 }}>{row.retailerName}</div>
          <div style={{ color: DIM, fontSize: 11, marginTop: 2 }}>
            <code>{row.email}</code>
            {row.buyerName ? ` · ${row.buyerName}` : ""}
          </div>
          <div style={{ color: DIM, fontSize: 12, marginTop: 4 }}>
            Source <code>{row.source}</code>
          </div>
          <div style={{ color: color, fontSize: 12, marginTop: 4 }}>
            <strong>{row.daysSinceSent ?? "?"}</strong> day
            {row.daysSinceSent === 1 ? "" : "s"} since sent
            {row.sentAt ? ` (${row.sentAt.slice(0, 16)})` : ""}
            {row.sentBy ? ` · sent by ${row.sentBy}` : ""}
          </div>
          {row.hubspotContactId && (
            <div style={{ color: DIM, fontSize: 11, marginTop: 2 }}>
              HubSpot contact <code>{row.hubspotContactId}</code>
            </div>
          )}
          {row.gmailMessageId && (
            <div style={{ color: DIM, fontSize: 11, marginTop: 2 }}>
              Initial Gmail <code>{row.gmailMessageId}</code>
            </div>
          )}
          {isSent && (
            <div
              style={{
                color: GREEN,
                fontSize: 11,
                marginTop: 4,
                background: `${GREEN}10`,
                border: `1px solid ${GREEN}40`,
                borderRadius: 6,
                padding: "4px 6px",
              }}
            >
              Follow-up sent
              {row.followUpSentAt
                ? ` ${row.followUpSentAt.slice(0, 16)}`
                : ""}
              {row.followUpSentBy ? ` by ${row.followUpSentBy}` : ""}
              {row.followUpGmailMessageId
                ? ` · Gmail \`${row.followUpGmailMessageId}\``
                : ""}
            </div>
          )}
          {!isSent && isQueued && (
            <div
              style={{
                color: AMBER,
                fontSize: 11,
                marginTop: 4,
                background: `${AMBER}10`,
                border: `1px solid ${AMBER}40`,
                borderRadius: 6,
                padding: "4px 6px",
              }}
            >
              Follow-up approval queued
              {row.followUpQueuedAt
                ? ` ${row.followUpQueuedAt.slice(0, 16)}`
                : ""}
              {row.followUpRequestApprovalId
                ? ` · approval id ${row.followUpRequestApprovalId.slice(0, 8)}`
                : ""}
              . Waiting on Ben&apos;s click in <code>#ops-approvals</code>.
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {row.suggestedAction && (
            <div
              style={{
                fontSize: 11,
                color: DIM,
                background: BG,
                border: `1px dashed ${BORDER}`,
                borderRadius: 6,
                padding: "8px 10px",
                whiteSpace: "pre-wrap",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  fontWeight: 600,
                  color,
                  letterSpacing: 0.4,
                  marginBottom: 4,
                }}
              >
                Suggested next action
              </div>
              {row.suggestedAction}
            </div>
          )}
          {!isSent && (
            <button
              onClick={requestFollowUp}
              disabled={!canRequest}
              title={
                isQueued
                  ? "A follow-up approval is already queued for this invite."
                  : "Open a Class B faire-direct.follow-up approval card in #ops-approvals."
              }
              style={{
                padding: "6px 12px",
                fontSize: 12,
                background: GOLD,
                color: NAVY,
                border: 0,
                borderRadius: 6,
                cursor: !canRequest ? "not-allowed" : "pointer",
                opacity: !canRequest ? 0.5 : 1,
                fontWeight: 600,
              }}
            >
              {requesting
                ? "Opening approval…"
                : isQueued
                  ? "Approval already queued"
                  : "Request follow-up approval"}
            </button>
          )}
          {error && (
            <span style={{ fontSize: 11, color: RED }}>{error}</span>
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
              }}
            >
              Approval opened — id <code>{approvalInfo.approvalId}</code>.
              {approvalInfo.slackThread
                ? " Slack card posted to #ops-approvals — wait for Ben's click to drive the send."
                : " Approval stored, but Slack post may have failed — check #ops-audit."}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
