"use client";

import { useState } from "react";
import { Share2, Zap } from "lucide-react";
import { useSocialData } from "@/lib/ops/use-war-room-data";
import { RefreshButton } from "@/app/ops/components/RefreshButton";
import { SkeletonTable } from "@/app/ops/components/Skeleton";
import {
  NAVY,
  RED,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";

async function postSocial(payload: Record<string, unknown>) {
  const res = await fetch("/api/ops/marketing/social", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Social action failed (${res.status})`);
  return json;
}

async function autoPostAction(payload: Record<string, unknown>) {
  const res = await fetch("/api/ops/marketing/auto-post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Auto-post failed (${res.status})`);
  return json;
}

export function SocialTab() {
  const { data, loading, error, refresh } = useSocialData();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [xEnabled, setXEnabled] = useState(true);
  const [truthEnabled, setTruthEnabled] = useState(true);

  // Auto-post state
  const [autoTopic, setAutoTopic] = useState("");
  const [autoStyle, setAutoStyle] = useState("social-post");
  const [autoDryRun, setAutoDryRun] = useState(false);
  const [autoResult, setAutoResult] = useState<Record<string, unknown> | null>(null);

  const submitPost = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const payload = {
        text: text.trim(),
        platforms: [xEnabled ? "x" : null, truthEnabled ? "truth" : null].filter(Boolean),
      };
      const result = await postSocial(payload);
      setMessage(result.ok ? "Post dispatched." : "Post failed.");
      setText("");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submitAutoPost = async () => {
    if (!autoTopic.trim()) return;
    setBusy(true);
    setMessage(null);
    setAutoResult(null);
    try {
      const platforms = [xEnabled ? "x" : null, truthEnabled ? "truth" : null].filter(Boolean);
      const result = await autoPostAction({
        topic: autoTopic.trim(),
        platforms,
        style: autoStyle,
        dryRun: autoDryRun,
      });
      setAutoResult(result);
      setMessage(autoDryRun ? "Dry run complete — preview below." : `Auto-post sent to ${platforms.length} platform(s).`);
      if (!autoDryRun) setAutoTopic("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const autoRespond = async (platform: "x" | "truth", targetId: string, sourceText: string) => {
    const suggested = `Thanks for reaching out to USA Gummies. We appreciate you and are happy to help.`;
    const text = window.prompt("Auto-response text", suggested) || suggested;
    setBusy(true);
    setMessage(null);
    try {
      await postSocial({ action: "auto-respond", platform, targetId, text: `${text}\n\n(Ref: ${sourceText.slice(0, 40)})` });
      setMessage("Response sent.");
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
          <div style={{ fontSize: 22, color: NAVY, fontWeight: 800, letterSpacing: "-0.01em" }}>Social</div>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
            Publish to X and Truth Social, track engagement, and clear mention backlog.
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
        <div style={{ border: `1px solid ${BORDER}`, background: CARD, color: NAVY, borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontWeight: 700 }}>
          {message}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 14 }}>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 8 }}>X Platform</div>
          <div style={{ fontSize: 13, color: TEXT_DIM, marginBottom: 6 }}>
            Status: {data?.platforms.x.configured ? "Connected" : "Not configured"}
          </div>
          <div style={{ fontSize: 13, color: TEXT_DIM }}>Recent posts: {data?.platforms.x.recentPosts.length || 0}</div>
          <div style={{ fontSize: 13, color: TEXT_DIM }}>Mentions pending: {data?.platforms.x.unrespondedMentions.length || 0}</div>
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 8 }}>Truth Social</div>
          <div style={{ fontSize: 13, color: TEXT_DIM, marginBottom: 6 }}>
            Status: {data?.platforms.truth.configured ? "Connected" : "Not configured"}
          </div>
          <div style={{ fontSize: 13, color: TEXT_DIM }}>Recent posts: {data?.platforms.truth.recentPosts.length || 0}</div>
          <div style={{ fontSize: 13, color: TEXT_DIM }}>Mentions pending: {data?.platforms.truth.unrespondedMentions.length || 0}</div>
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: NAVY, marginBottom: 8 }}>
          <Share2 size={16} />
          Post Composer
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Write your post..."
          style={{ width: "100%", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 12px", fontSize: 13, resize: "vertical", marginBottom: 8 }}
        />
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <label style={{ fontSize: 12, color: NAVY, fontWeight: 700 }}>
            <input type="checkbox" checked={xEnabled} onChange={(e) => setXEnabled(e.target.checked)} /> X
          </label>
          <label style={{ fontSize: 12, color: NAVY, fontWeight: 700 }}>
            <input type="checkbox" checked={truthEnabled} onChange={(e) => setTruthEnabled(e.target.checked)} /> Truth Social
          </label>
        </div>
        <button
          onClick={submitPost}
          disabled={busy || !text.trim() || (!xEnabled && !truthEnabled)}
          style={{ border: `1px solid ${BORDER}`, borderRadius: 8, background: NAVY, color: "#fff", fontSize: 12, fontWeight: 700, padding: "8px 12px", cursor: "pointer" }}
        >
          Post Now
        </button>
      </div>

      {/* Auto-Post Engine */}
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: NAVY, marginBottom: 8 }}>
          <Zap size={16} />
          Auto-Post Engine (Nano Banana 2 + GPT-4o)
        </div>
        <div style={{ fontSize: 12, color: TEXT_DIM, marginBottom: 10 }}>
          Enter a topic — the engine generates social copy (GPT-4o), a matching image (Gemini), and posts to selected platforms.
        </div>
        <input
          value={autoTopic}
          onChange={(e) => setAutoTopic(e.target.value)}
          placeholder="Topic (e.g., 'Why American-made gummy vitamins are the healthier choice')"
          style={{ width: "100%", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 8 }}
        />
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
          <select value={autoStyle} onChange={(e) => setAutoStyle(e.target.value)} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 10px", fontSize: 12 }}>
            <option value="social-post">Social Post</option>
            <option value="product-hero">Product Hero</option>
            <option value="lifestyle">Lifestyle</option>
            <option value="patriotic">Patriotic</option>
            <option value="health-wellness">Health & Wellness</option>
          </select>
          <label style={{ fontSize: 12, color: NAVY, fontWeight: 700 }}>
            <input type="checkbox" checked={autoDryRun} onChange={(e) => setAutoDryRun(e.target.checked)} /> Dry Run (preview only)
          </label>
        </div>
        <button
          onClick={submitAutoPost}
          disabled={busy || !autoTopic.trim()}
          style={{ border: `1px solid ${BORDER}`, borderRadius: 8, background: "#d4380d", color: "#fff", fontSize: 12, fontWeight: 700, padding: "8px 14px", cursor: "pointer" }}
        >
          {busy ? "Generating..." : autoDryRun ? "Preview Auto-Post" : "Generate & Post"}
        </button>

        {autoResult ? (
          <div style={{ marginTop: 12, borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>
            <div style={{ fontSize: 12, color: NAVY, fontWeight: 700, marginBottom: 6 }}>Generated Copy:</div>
            {autoResult.copy ? (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 11, color: TEXT_DIM }}><strong>X:</strong> {String((autoResult.copy as Record<string, unknown>).x || "")}</div>
                <div style={{ fontSize: 11, color: TEXT_DIM }}><strong>Truth:</strong> {String((autoResult.copy as Record<string, unknown>).truth || "")}</div>
                <div style={{ fontSize: 11, color: TEXT_DIM }}><strong>Instagram:</strong> {String((autoResult.copy as Record<string, unknown>).instagram || "")}</div>
              </div>
            ) : null}
            <div style={{ marginTop: 6, fontSize: 11, color: TEXT_DIM }}>
              Image: {autoResult.imageGenerated ? "Generated" : "Skipped"} |
              Status: {autoResult.dryRun ? "Dry Run" : "Posted"}
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Recent Posts</div>
          {loading && (data?.platforms.x.recentPosts || []).length === 0 ? (
            <SkeletonTable rows={6} />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Platform</th>
                    <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Text</th>
                    <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Engagement</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(data?.platforms.x.recentPosts || []).slice(0, 8).map((post) => ({ platform: "X", id: post.id, text: post.text, engagement: post.likes + post.replies + post.reposts })), ...(data?.platforms.truth.recentPosts || []).slice(0, 8).map((post) => ({ platform: "Truth", id: post.id, text: post.text, engagement: post.likes + post.replies + post.reposts }))].map((post) => (
                    <tr key={`${post.platform}-${post.id}`}>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: NAVY, fontWeight: 700 }}>{post.platform}</td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: TEXT_DIM }}>{post.text.replace(/<[^>]+>/g, "").slice(0, 80)}</td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: NAVY }}>{post.engagement}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>
            Mentions Inbox ({data?.autoResponder.enabled ? "Auto-responder ON" : "Auto-responder OFF"})
          </div>
          <div style={{ marginBottom: 8, fontSize: 12, color: TEXT_DIM }}>
            Responses today: {data?.autoResponder.responseCountToday || 0}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {(data?.platforms.x.unrespondedMentions || []).slice(0, 5).map((mention) => (
              <div key={`x-${mention.id}`} style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
                <div style={{ fontSize: 12, color: NAVY, fontWeight: 700, marginBottom: 4 }}>X mention</div>
                <div style={{ fontSize: 12, color: TEXT_DIM, marginBottom: 6 }}>{mention.text.replace(/<[^>]+>/g, "").slice(0, 130)}</div>
                <button onClick={() => autoRespond("x", mention.id, mention.text)} style={{ border: `1px solid ${BORDER}`, borderRadius: 6, background: CARD, color: NAVY, fontSize: 11, fontWeight: 700, padding: "4px 8px" }}>
                  Auto-Respond
                </button>
              </div>
            ))}
            {(data?.platforms.truth.unrespondedMentions || []).slice(0, 5).map((mention) => (
              <div key={`truth-${mention.id}`} style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
                <div style={{ fontSize: 12, color: NAVY, fontWeight: 700, marginBottom: 4 }}>Truth mention</div>
                <div style={{ fontSize: 12, color: TEXT_DIM, marginBottom: 6 }}>{mention.text.replace(/<[^>]+>/g, "").slice(0, 130)}</div>
                <button onClick={() => autoRespond("truth", mention.id, mention.text)} style={{ border: `1px solid ${BORDER}`, borderRadius: 6, background: CARD, color: NAVY, fontSize: 11, fontWeight: 700, padding: "4px 8px" }}>
                  Auto-Respond
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
