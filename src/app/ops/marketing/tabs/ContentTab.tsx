"use client";

import { useMemo, useState } from "react";
import { WandSparkles } from "lucide-react";
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

export function ContentTab() {
  const { data, loading, error, refresh } = useContentData();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [outline, setOutline] = useState("");

  const topPosts = useMemo(() => (data?.topPosts || []).slice(0, 15), [data]);

  const approve = async (id: string) => {
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
  };

  const reject = async (id: string) => {
    const reason = window.prompt("Reject reason (optional):", "Needs revision") || "Needs revision";
    setBusy(true);
    setMessage(null);
    try {
      await runAction({ action: "reject", pageId: id, reason });
      setMessage("Draft rejected.");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const edit = async (id: string, title: string, body: string) => {
    const nextTitle = window.prompt("Edit title", title) || title;
    const nextBody = window.prompt("Edit body (short edits recommended)", body) || body;
    setBusy(true);
    setMessage(null);
    try {
      await runAction({ action: "edit", pageId: id, title: nextTitle, body: nextBody });
      setMessage("Draft updated.");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

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
                          onClick={() => edit(draft.id, draft.title, draft.body)}
                          disabled={busy}
                          style={{ border: `1px solid ${BORDER}`, borderRadius: 6, background: CARD, color: NAVY, fontSize: 11, fontWeight: 700, padding: "4px 8px" }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => approve(draft.id)}
                          disabled={busy}
                          style={{ border: `1px solid ${BORDER}`, borderRadius: 6, background: NAVY, color: "#fff", fontSize: 11, fontWeight: 700, padding: "4px 8px" }}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => reject(draft.id)}
                          disabled={busy}
                          style={{ border: `1px solid ${RED}44`, borderRadius: 6, background: `${RED}12`, color: RED, fontSize: 11, fontWeight: 700, padding: "4px 8px" }}
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
