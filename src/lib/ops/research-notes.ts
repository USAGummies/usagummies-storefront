/**
 * Research notes — KV-backed store for R-1..R-7 findings.
 *
 * Usage:
 *  - Claude Code sessions (or Ben / Rene ad-hoc) call
 *    POST /api/ops/research/note with `{ code: "R-3", ... }` whenever
 *    they surface something worth capturing against a research stream.
 *  - The Research Librarian (/api/ops/agents/research/run) reads the
 *    last 7–14 days of notes and renders the weekly #research digest.
 *
 * This deliberately does NOT require the full Open Brain / Supabase
 * pgvector path. That's a phase-2 build. The KV store here is enough
 * to close the loop — "every research stream has a posting surface
 * and a weekly synthesis" — without gating on pgvector migration.
 *
 * When the Open Brain MCP path lands, migrate these into Supabase
 * `open_brain_entries` tagged `research:<code>` and replace this
 * helper — the Librarian only reads; the source-of-truth swap is
 * backwards-compatible.
 */

import { kv } from "@vercel/kv";

export const RESEARCH_CODES = ["R-1", "R-2", "R-3", "R-4", "R-5", "R-6", "R-7"] as const;
export type ResearchCode = (typeof RESEARCH_CODES)[number];

export const RESEARCH_PROMPTS: Record<ResearchCode, { title: string; prompt: string }> = {
  "R-1": {
    title: "Consumer",
    prompt:
      "What's the current sentiment on dye-free candy in the last 7 days? Anecdotes from Reddit / TikTok / parent forums. Anything to cite in marketing?",
  },
  "R-2": {
    title: "Market",
    prompt:
      "US better-for-you gummy category — total size, growth rate, top 3 brands by share, recent category price movements. Cite sources.",
  },
  "R-3": {
    title: "Competitive",
    prompt:
      "Any new entrant or product move from Haribo, Trolli, Sour Patch, SmartSweets, Behave, Project 7, Tom & Jenny's, Smashmallow, or a previously-unknown dye-free player in the last 7 days?",
  },
  "R-4": {
    title: "Channel",
    prompt:
      "Retailer and distributor moves this week — acquisitions, ordering changes, new programs. Target categories: natural, c-store, souvenir shops, airports, museums, military exchange, co-ops.",
  },
  "R-5": {
    title: "Regulatory",
    prompt:
      "FDA / FTC / USDA / state AG actions on food dyes, labeling claims, or candy-adjacent items in the last 30 days. Anything that could move our claim gate?",
  },
  "R-6": {
    title: "Supply",
    prompt:
      "Ingredient pricing + availability — corn syrup, gelatin, pectin, natural colors (annatto, turmeric, beet, spirulina). Any supply shocks affecting Powers / Albanese / upstream ingredient suppliers?",
  },
  "R-7": {
    title: "Press",
    prompt:
      "Press mentions of USA Gummies or dye-free candy from reporters / podcasts / industry pubs in the last 7 days. Any incoming HARO-style opportunities worth responding to?",
  },
};

const KV_RESEARCH_NOTES = "research:notes";
const MAX_NOTES = 500;

export interface ResearchNote {
  id: string;
  code: ResearchCode;
  title: string;
  summary: string;
  sources: string[];
  confidence: number; // 0.0–1.0
  capturedAt: string;
  capturedBy: string;
}

export interface ResearchNoteInput {
  code: ResearchCode;
  title: string;
  summary: string;
  sources?: string[];
  confidence?: number;
  capturedBy?: string;
}

export async function addResearchNote(input: ResearchNoteInput): Promise<ResearchNote> {
  const existing = (await kv.get<ResearchNote[]>(KV_RESEARCH_NOTES)) ?? [];
  const note: ResearchNote = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    code: input.code,
    title: input.title.trim().slice(0, 200),
    summary: input.summary.trim().slice(0, 2000),
    sources: (input.sources ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 10),
    confidence: clamp01(input.confidence ?? 0.8),
    capturedAt: new Date().toISOString(),
    capturedBy: input.capturedBy?.trim() || "claude-code",
  };
  const next = [note, ...existing].slice(0, MAX_NOTES);
  await kv.set(KV_RESEARCH_NOTES, next);
  return note;
}

export async function listResearchNotes(daysBack = 7): Promise<ResearchNote[]> {
  const existing = (await kv.get<ResearchNote[]>(KV_RESEARCH_NOTES)) ?? [];
  const cutoff = Date.now() - daysBack * 24 * 3600 * 1000;
  return existing.filter((n) => new Date(n.capturedAt).getTime() >= cutoff);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
