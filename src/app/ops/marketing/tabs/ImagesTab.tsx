"use client";

import { useMemo, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { useImageLibrary } from "@/lib/ops/use-war-room-data";
import { RefreshButton } from "@/app/ops/components/RefreshButton";
import { SkeletonTable } from "@/app/ops/components/Skeleton";
import {
  NAVY,
  RED,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";

async function postAction(payload: Record<string, unknown>) {
  const res = await fetch("/api/ops/marketing/images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Image action failed (${res.status})`);
  return json;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ImagesTab() {
  const { data, loading, error, refresh } = useImageLibrary();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [category, setCategory] = useState("all");
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [generateTitle, setGenerateTitle] = useState("");
  const [generateTags, setGenerateTags] = useState("");

  const filtered = useMemo(() => {
    const all = data?.images || [];
    if (category === "all") return all;
    return all.filter((img) => img.category === category);
  }, [data, category]);

  const onUpload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const base64 = await fileToBase64(file);
      await postAction({
        action: "upload",
        filename: file.name,
        title: file.name.replace(/\.[^.]+$/, ""),
        contentBase64: base64,
        category: "blog",
      });
      setMsg("Image uploaded.");
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onGenerate = async () => {
    if (!generatePrompt.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await postAction({
        action: "generate",
        title: generateTitle || undefined,
        prompt: generatePrompt,
        tags: generateTags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        category: "blog",
      });
      setMsg("Image generated and saved.");
      setGeneratePrompt("");
      setGenerateTitle("");
      setGenerateTags("");
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, color: NAVY, fontWeight: 800, letterSpacing: "-0.01em" }}>Image Library</div>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
            Upload and generate reusable creative assets for blog, social, and paid campaigns.
          </div>
        </div>
        <RefreshButton onClick={refresh} loading={loading || busy} />
      </div>

      {error ? <div style={{ marginBottom: 12, color: RED, fontWeight: 700 }}>{error}</div> : null}
      {msg ? <div style={{ marginBottom: 12, color: NAVY, fontWeight: 700 }}>{msg}</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: NAVY, fontWeight: 800, marginBottom: 8 }}>
            <ImageIcon size={16} /> Upload
          </div>
          <input type="file" accept="image/*" onChange={(e) => onUpload(e.target.files?.[0] || null)} />
          <div style={{ marginTop: 8, fontSize: 12, color: TEXT_DIM }}>
            Files save to `/public/content-library/` and log to Notion Image Library.
          </div>
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: NAVY, fontWeight: 800, marginBottom: 8 }}>
            <ImageIcon size={16} /> Generate (DALL-E 3)
          </div>
          <input value={generateTitle} onChange={(e) => setGenerateTitle(e.target.value)} placeholder="Title (optional)" style={{ width: "100%", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 12, marginBottom: 8 }} />
          <textarea value={generatePrompt} onChange={(e) => setGeneratePrompt(e.target.value)} rows={3} placeholder="Prompt" style={{ width: "100%", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 12, marginBottom: 8 }} />
          <input value={generateTags} onChange={(e) => setGenerateTags(e.target.value)} placeholder="Tags (comma-separated)" style={{ width: "100%", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 12, marginBottom: 8 }} />
          <button onClick={onGenerate} disabled={busy || !generatePrompt.trim()} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, background: NAVY, color: "#fff", fontSize: 12, fontWeight: 700, padding: "8px 12px" }}>
            Generate Image
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 10, display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: TEXT_DIM }}>Filter:</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 10px", fontSize: 12 }}>
          <option value="all">All</option>
          <option value="product">Product</option>
          <option value="lifestyle">Lifestyle</option>
          <option value="social">Social</option>
          <option value="blog">Blog</option>
          <option value="ad">Ad</option>
        </select>
      </div>

      {loading && filtered.length === 0 ? (
        <SkeletonTable rows={8} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
          {filtered.map((img) => (
            <div key={img.id} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ aspectRatio: "1 / 1", background: "rgba(27,42,74,0.05)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.title}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              </div>
              <div style={{ padding: 8 }}>
                <div style={{ fontSize: 12, color: NAVY, fontWeight: 700, marginBottom: 4 }}>{img.title}</div>
                <div style={{ fontSize: 11, color: TEXT_DIM, marginBottom: 4 }}>{img.category} • {img.source}</div>
                <div style={{ fontSize: 11, color: TEXT_DIM }}>{img.tags.join(", ")}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
