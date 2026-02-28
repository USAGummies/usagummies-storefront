"use client";

import { useMemo, useState, useCallback } from "react";
import { WandSparkles, X } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";
import { useContentData, fmtDollar } from "@/lib/ops/use-war-room-data";
import { RefreshButton } from "@/app/ops/components/RefreshButton";
import { SkeletonChart, SkeletonTable } from "@/app/ops/components/Skeleton";
import {
  NAVY,
  RED,
  GOLD,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";

async function runAction(payload: Record<string, unknown>) {
  const res = await fetch("/api/ops/marketing/content/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Action failed (${res.status})`);
  }
  return json;
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Inline Modal Components ────────────────────────────────────────────────

function RejectModal({ onConfirm, onCancel }: { onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("Needs revision");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onCancel}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: 420, maxWidth: "90vw", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: NAVY }}>Reject Draft</div>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><X size={18} color={TEXT_DIM} /></button>
        </div>
        <div style={{ marginBottom: 8, fontSize: 13, color: TEXT_DIM }}>Provide a reason (optional):</div>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
          style={{ width: "100%", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 12px", fontSize: 13, boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, background: CARD, color: NAVY, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
          <button onClick={() => onConfirm(reason)} style={{ border: `1px solid ${RED}44`, borderRadius: 8, background: RED, color: "#fff", padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Reject</button>
        </div>
      </div>
    </div>
  );
}

function EditModal({ title: initTitle, body: initBody, onConfirm, onCancel }: { title: string; body: string; onConfirm: (title: string, body: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(initTitle);
  const [body, setBody] = useState(initBody);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onCancel}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: 640, maxWidth: "90vw", maxHeight: "85vh", overflow: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: NAVY }}>Edit Draft</div>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><X size={18} color={TEXT_DIM} /></button>
        </div>
        <div style={{ marginBottom: 6, fontSize: 13, fontWeight: 700, color: NAVY }}>Title</div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          style={{ width: "100%", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 12, boxSizing: "border-box" }}
        />
        <div style={{ marginBottom: 6, fontSize: 13, fontWeight: 700, color: NAVY }}>Body (MDX)</div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={14}
          style={{ width: "100%", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 12px", fontSize: 12, fontFamily: "ui-monospace, monospace", resize: "vertical", boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, background: CARD, color: NAVY, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
          <button onClick={() => onConfirm(title, body)} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, background: NAVY, color: "#fff", padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function ContentTab() {
  const { data, loading, error, refresh } = useContentData();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [outline, setOutline] = useState("");

  // Modal state
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<{ id: string; title: string; body: string } | null>(null);

  const topPosts = useMemo(() => (data?.topPosts || []).slice(0, 15), [data]);

  const approve = useCallback(async (id: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await runAction({ action: "approve", pageId: id });
      setMessage(`Published ${result?.published?.slug || "draft"}.`);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const confirmReject = useCallback(async (reason: string) => {
    if (!rejectTarget) return;
    setRejectTarget(null);
    setBusy(true);
    setMessage(null);
    try {
      await runAction({ action: "reject", pageId: rejectTarget, reason });
      setMessage("Draft rejected.");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [rejectTarget, refresh]);

  const confirmEdit = useCallback(async (title: string, body: string) => {
    if (!editTarget) return;
    setEditTarget(null);
    setBusy(true);
    setMessage(null);
    try {
      await runAction({ action: "edit", pageId: editTarget.id, title, body });
      setMessage("Draft updated.");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [editTarget, refresh]);

  const generate = async () => {
    if (!keyword.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await runAction({
        action: "generate",
        keyword: keyword.trim(),
        outline: outline.trim() || undefined,
      });
      setMessage(`Generated draft: ${result?.draft?.title || "Untitled"}`);
      setKeyword("");
      setOutline("");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {/* Modals */}
      {rejectTarget ? <RejectModal onConfirm={confirmReject} onCancel={() => setRejectTarget(null)} /> : null}
      {editTarget ? <EditModal title={editTarget.title} body={editTarget.body} onConfirm={confirmEdit} onCancel={() => setEditTarget(null)} /> : null}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, color: NAVY, fontWeight: 800, letterSpacing: "-0.01em" }}>Content & SEO</div>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
            AI drafting queue, publication workflow, and blog performance overview.
          </div>
        </div>
        <RefreshButton onClick={refresh} loading={loading || busy} />
      </div>

      {error ? (
        <div style={{ border: `1px solid ${RED}33`, background: `${RED}14`, color: RED, borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontWeight: 700 }}>
          {error}
        </div>
      ) : null}
      {message ? (
        <div style={{ border: `1px solid ${GOLD}33`, background: `${GOLD}14`, color: NAVY, borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontWeight: 700 }}>
          {message}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 14 }}>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11, color: TEXT_DIM, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em" }}>Published Posts</div>
          <div style={{ fontSize: 28, color: NAVY, fontWeight: 800 }}>{data?.summary.publishedPosts || 0}</div>
        </div>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11, color: TEXT_DIM, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em" }}>Blog Pageviews (30d)</div>
          <div style={{ fontSize: 28, color: NAVY, fontWeight: 800 }}>{(data?.summary.totalBlogPageviews || 0).toLocaleString("en-US")}</div>
        </div>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11, color: TEXT_DIM, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em" }}>Avg Engagement</div>
          <div style={{ fontSize: 28, color: NAVY, fontWeight: 800 }}>{(data?.summary.avgEngagementTime || 0).toFixed(1)}s</div>
        </div>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11, color: TEXT_DIM, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em" }}>Blog → Purchase</div>
          <div style={{ fontSize: 28, color: NAVY, fontWeight: 800 }}>{fmtDollar(data?.summary.blogToPurchaseConversions || 0)}</div>
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Top 15 Posts by Pageviews</div>
        {loading && topPosts.length === 0 ? (
          <SkeletonChart height={250} />
        ) : (
          <div style={{ width: "100%", height: 250 }}>
            <ResponsiveContainer>
              <BarChart data={topPosts} layout="vertical" margin={{ left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                <XAxis type="number" tick={{ fontSize: 11, fill: TEXT_DIM }} />
                <YAxis
                  dataKey="title"
                  type="category"
                  tick={{ fontSize: 11, fill: TEXT_DIM }}
                  width={180}
                  tickFormatter={(value: string) => value.slice(0, 32)}
                />
                <Tooltip />
                <Bar dataKey="pageviews" fill={NAVY} radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: NAVY, marginBottom: 10 }}>
          <WandSparkles size={16} />
          Generate New Draft
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Target keyword (e.g. blue 1 dye in candy)"
            style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 12px", fontSize: 13 }}
          />
          <textarea
            value={outline}
            onChange={(e) => setOutline(e.target.value)}
            placeholder="Optional outline guidance"
            rows={3}
            style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 12px", fontSize: 13, resize: "vertical" }}
          />
          <div>
            <button
              onClick={generate}
              disabled={busy || !keyword.trim()}
              style={{
                border: `1px solid ${BORDER}`,
                borderRadius: 8,
                background: NAVY,
                color: "#fff",
                padding: "8px 12px",
                fontSize: 12,
                fontWeight: 700,
                cursor: busy || !keyword.trim() ? "not-allowed" : "pointer",
                opacity: busy || !keyword.trim() ? 0.6 : 1,
              }}
            >
              Generate Draft
            </button>
          </div>
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Draft Queue</div>
        {loading && (data?.draftQueue || []).length === 0 ? (
          <SkeletonTable rows={8} />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Title</th>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Keyword</th>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Status</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Words</th>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Created</th>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(data?.draftQueue || []).map((draft) => (
                  <tr key={draft.id}>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: NAVY, fontWeight: 700 }}>{draft.title}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: TEXT_DIM }}>{draft.targetKeyword}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: NAVY }}>{draft.status}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: NAVY }}>{draft.wordCount}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: TEXT_DIM }}>{fmtDate(draft.generatedAt)}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0" }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          onClick={() => setEditTarget({ id: draft.id, title: draft.title, body: draft.body })}
                          disabled={busy}
                          style={{ border: `1px solid ${BORDER}`, borderRadius: 6, background: CARD, color: NAVY, fontSize: 11, fontWeight: 700, padding: "4px 8px", cursor: busy ? "not-allowed" : "pointer" }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => approve(draft.id)}
                          disabled={busy}
                          style={{ border: `1px solid ${BORDER}`, borderRadius: 6, background: NAVY, color: "#fff", fontSize: 11, fontWeight: 700, padding: "4px 8px", cursor: busy ? "not-allowed" : "pointer" }}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => setRejectTarget(draft.id)}
                          disabled={busy}
                          style={{ border: `1px solid ${RED}44`, borderRadius: 6, background: `${RED}12`, color: RED, fontSize: 11, fontWeight: 700, padding: "4px 8px", cursor: busy ? "not-allowed" : "pointer" }}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: TEXT_DIM }}>
        Engine status: S1 {fmtDate(data?.engineStatus.s1LastRun)} • S3 {fmtDate(data?.engineStatus.s3LastRun)} • S5 {fmtDate(data?.engineStatus.s5LastRun)}
      </div>
    </div>
  );
}
