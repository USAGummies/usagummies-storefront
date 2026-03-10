"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  NAVY,
  RED,
  GOLD,
  CREAM as BG,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";

type CompetitorEntry = {
  id: string;
  competitor_name: string;
  data_type: string;
  title: string;
  detail: string | null;
  source_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type FormState = {
  id: string | null;
  name: string;
  website: string;
  category: string;
  products: string;
  strengths: string;
  weaknesses: string;
  notes: string;
};

const CATEGORY_OPTIONS = [
  "Direct Competitor",
  "Adjacent Brand",
  "Aspirational",
  "Private Label",
];

const DEFAULT_FORM: FormState = {
  id: null,
  name: "",
  website: "",
  category: CATEGORY_OPTIONS[0],
  products: "",
  strengths: "",
  weaknesses: "",
  notes: "",
};

function mapCategoryToDataType(category: string): string {
  if (category === "Private Label") return "pricing";
  if (category === "Adjacent Brand") return "product";
  return "market_position";
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toForm(entry: CompetitorEntry): FormState {
  const metadata = entry.metadata || {};
  return {
    id: entry.id,
    name: entry.competitor_name || "",
    website: asText(metadata.website) || entry.source_url || "",
    category: asText(metadata.category) || "Direct Competitor",
    products: asText(metadata.products),
    strengths: asText(metadata.strengths),
    weaknesses: asText(metadata.weaknesses),
    notes: asText(metadata.notes),
  };
}

function buildDetail(form: FormState): string {
  return [
    form.products ? `Products: ${form.products}` : "",
    form.strengths ? `Strengths: ${form.strengths}` : "",
    form.weaknesses ? `Weaknesses: ${form.weaknesses}` : "",
    form.notes ? `Notes: ${form.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function CompetitorsView() {
  const router = useRouter();
  const [entries, setEntries] = useState<CompetitorEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ops/abra/competitors?limit=200", { cache: "no-store" });
      const data = (await res.json()) as { entries?: CompetitorEntry[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to load competitors");
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load competitors");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchEntries();
  }, [fetchEntries]);

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [entries]);

  function openCreate() {
    setForm(DEFAULT_FORM);
    setModalOpen(true);
  }

  function openEdit(entry: CompetitorEntry) {
    setForm(toForm(entry));
    setModalOpen(true);
  }

  async function onDelete(entry: CompetitorEntry) {
    if (!window.confirm(`Delete competitor "${entry.competitor_name}"?`)) return;
    try {
      const res = await fetch(`/api/ops/abra/competitors?id=${encodeURIComponent(entry.id)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Delete failed");
      await fetchEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete competitor");
    }
  }

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const payload = {
        id: form.id,
        competitor_name: form.name.trim(),
        data_type: mapCategoryToDataType(form.category),
        title: `${form.name.trim()} profile`,
        detail: buildDetail(form),
        source: "manual",
        source_url: form.website.trim() || null,
        department: "sales_and_growth",
        metadata: {
          category: form.category,
          website: form.website.trim(),
          products: form.products.trim(),
          strengths: form.strengths.trim(),
          weaknesses: form.weaknesses.trim(),
          notes: form.notes.trim(),
        },
      };

      const method = form.id ? "PATCH" : "POST";
      const res = await fetch("/api/ops/abra/competitors", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Save failed");

      setModalOpen(false);
      setForm(DEFAULT_FORM);
      await fetchEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save competitor");
    } finally {
      setSaving(false);
    }
  }

  function askAbra(name: string) {
    const question = `Analyze our competitive position vs ${name}. Consider: pricing, product range, distribution channels, brand positioning.`;
    router.push(`/ops/abra?q=${encodeURIComponent(question)}`);
  }

  return (
    <div style={{ background: BG, minHeight: "100vh", paddingBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 30, color: NAVY, letterSpacing: "-0.02em" }}>Competitive Intelligence</h1>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
            Track competitor pricing, positioning, and strategic notes.
          </div>
        </div>
        <button
          onClick={openCreate}
          style={{
            border: `1px solid ${GOLD}`,
            background: `${GOLD}18`,
            color: NAVY,
            borderRadius: 10,
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Add Competitor
        </button>
      </div>

      {error ? (
        <div style={{ border: `1px solid ${RED}33`, background: `${RED}12`, color: RED, borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 13, fontWeight: 700 }}>
          {error}
        </div>
      ) : null}

      {loading ? (
        <div style={{ color: TEXT_DIM, fontSize: 13 }}>Loading competitors...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
          {sortedEntries.map((entry) => {
            const metadata = entry.metadata || {};
            const website = asText(metadata.website) || entry.source_url || "";
            const category = asText(metadata.category) || entry.data_type;
            const products = asText(metadata.products);
            const strengths = asText(metadata.strengths);
            const weaknesses = asText(metadata.weaknesses);
            const notes = asText(metadata.notes);

            return (
              <div key={entry.id} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 15, color: NAVY, fontWeight: 800 }}>{entry.competitor_name}</div>
                    {website ? (
                      <a href={website} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: NAVY, textDecoration: "underline" }}>
                        {website}
                      </a>
                    ) : (
                      <div style={{ fontSize: 12, color: TEXT_DIM }}>No website</div>
                    )}
                  </div>
                  <span style={{ border: `1px solid ${BORDER}`, background: BG, borderRadius: 999, padding: "2px 8px", fontSize: 11, color: NAVY, fontWeight: 700 }}>
                    {category}
                  </span>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, color: TEXT_DIM }}>
                    <strong style={{ color: NAVY }}>Products:</strong> {products || "—"}
                  </div>
                  <div style={{ fontSize: 12, color: TEXT_DIM }}>
                    <strong style={{ color: NAVY }}>Strengths:</strong> {strengths || "—"}
                  </div>
                  <div style={{ fontSize: 12, color: TEXT_DIM }}>
                    <strong style={{ color: NAVY }}>Weaknesses:</strong> {weaknesses || "—"}
                  </div>
                  <div style={{ fontSize: 12, color: TEXT_DIM }}>
                    <strong style={{ color: NAVY }}>Notes:</strong> {notes || entry.detail || "—"}
                  </div>
                  <div style={{ fontSize: 11, color: TEXT_DIM }}>
                    Last updated {new Date(entry.created_at).toLocaleDateString("en-US")}
                  </div>
                </div>

                <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <button
                    onClick={() => askAbra(entry.competitor_name)}
                    style={{ border: `1px solid ${GOLD}`, background: `${GOLD}10`, color: NAVY, borderRadius: 8, padding: "6px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                  >
                    Ask Abra
                  </button>
                  <button
                    onClick={() => openEdit(entry)}
                    style={{ border: `1px solid ${BORDER}`, background: CARD, color: NAVY, borderRadius: 8, padding: "6px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => void onDelete(entry)}
                    style={{ border: `1px solid ${RED}55`, background: `${RED}0f`, color: RED, borderRadius: 8, padding: "6px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalOpen ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,22,40,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
          <div style={{ width: "min(700px, 100%)", maxHeight: "95vh", overflowY: "auto", background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 18, color: NAVY, fontWeight: 800 }}>
                {form.id ? "Edit Competitor" : "Add Competitor"}
              </div>
              <button
                onClick={() => setModalOpen(false)}
                style={{ border: "none", background: "transparent", color: TEXT_DIM, fontSize: 20, cursor: "pointer", lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <form onSubmit={onSave} style={{ display: "grid", gap: 10 }}>
              <label style={{ display: "grid", gap: 4, fontSize: 12, color: NAVY, fontWeight: 700 }}>
                Name
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 13 }}
                />
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: 12, color: NAVY, fontWeight: 700 }}>
                Website
                <input
                  value={form.website}
                  onChange={(e) => setForm((prev) => ({ ...prev, website: e.target.value }))}
                  placeholder="https://example.com"
                  style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 13 }}
                />
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: 12, color: NAVY, fontWeight: 700 }}>
                Category
                <select
                  value={form.category}
                  onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                  style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, background: "#fff" }}
                >
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: 12, color: NAVY, fontWeight: 700 }}>
                Products / Price Range
                <textarea
                  value={form.products}
                  onChange={(e) => setForm((prev) => ({ ...prev, products: e.target.value }))}
                  rows={3}
                  style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, resize: "vertical" }}
                />
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: 12, color: NAVY, fontWeight: 700 }}>
                Strengths
                <textarea
                  value={form.strengths}
                  onChange={(e) => setForm((prev) => ({ ...prev, strengths: e.target.value }))}
                  rows={2}
                  style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, resize: "vertical" }}
                />
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: 12, color: NAVY, fontWeight: 700 }}>
                Weaknesses
                <textarea
                  value={form.weaknesses}
                  onChange={(e) => setForm((prev) => ({ ...prev, weaknesses: e.target.value }))}
                  rows={2}
                  style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, resize: "vertical" }}
                />
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: 12, color: NAVY, fontWeight: 700 }}>
                Notes
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                  style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, resize: "vertical" }}
                />
              </label>

              <div style={{ marginTop: 6, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  style={{ border: `1px solid ${BORDER}`, background: CARD, color: NAVY, borderRadius: 8, padding: "8px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ border: `1px solid ${GOLD}`, background: `${GOLD}1a`, color: NAVY, borderRadius: 8, padding: "8px 10px", fontSize: 12, fontWeight: 700, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}
                >
                  {saving ? "Saving..." : form.id ? "Update" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
