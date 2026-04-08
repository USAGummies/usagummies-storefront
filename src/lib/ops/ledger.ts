/**
 * LEDGER — Bookkeeping & Decision Persistence for USA Gummies
 *
 * Prevents context-window amnesia by storing:
 *   - Decisions & rulings (locked facts that never get re-asked)
 *   - Pending questions (questions asked, awaiting answers)
 *   - COA channel routing table (the 360-path matrix)
 *   - QBO entry queue (entries pending Rene's review)
 *
 * Data persisted in Vercel KV under ledger:* keys.
 * Syncs to Notion Decisions & Rulings DB.
 */

import { kv } from "@vercel/kv";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DecisionStatus = "resolved" | "pending" | "superseded";

export interface Decision {
  id: string;
  topic: string;
  decision: string;
  decided_by: string;
  date: string; // ISO date
  source_thread?: string; // Slack thread URL
  status: DecisionStatus;
  superseded_by?: string; // ID of newer decision
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface PendingQuestion {
  id: string;
  question: string;
  asked_by: string; // who asked (Viktor, Ben, etc.)
  asked_to: string; // who needs to answer (Rene, Ben, etc.)
  topic: string;
  asked_at: string; // ISO datetime
  source_thread?: string;
  status: "waiting" | "answered" | "withdrawn";
  answer?: string;
  answered_by?: string;
  answered_at?: string;
  notes?: string;
}

export interface ChannelRouting {
  channel: string; // e.g. "Amazon", "DTC", "Faire"
  revenue_acct: string; // e.g. "400015.05"
  cogs_acct: string; // e.g. "500015.05"
  freight_acct: string; // e.g. "500040.05"
  notes?: string;
}

export interface LedgerEntry {
  id: string;
  type: "journal_entry" | "invoice" | "payment" | "bill" | "expense";
  description: string;
  amount: number;
  debit_account: string;
  credit_account: string;
  date: string; // ISO date
  status: "draft" | "pending_review" | "approved" | "posted" | "rejected";
  reviewed_by?: string;
  reviewed_at?: string;
  source: string; // e.g. "INVENTORY", "ORDER_DESK", "manual"
  reference?: string; // PO#, invoice#, etc.
  notes?: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// KV Keys
// ---------------------------------------------------------------------------

const KV_DECISIONS = "ledger:decisions";
const KV_PENDING_QUESTIONS = "ledger:pending_questions";
const KV_COA_MAP = "ledger:coa_map";
const KV_ENTRIES = "ledger:entries";

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export async function listDecisions(
  filters?: { topic?: string; status?: DecisionStatus }
): Promise<Decision[]> {
  const all = (await kv.get<Decision[]>(KV_DECISIONS)) || [];
  let filtered = all;
  if (filters?.topic) {
    const t = filters.topic.toLowerCase();
    filtered = filtered.filter((d) => d.topic.toLowerCase().includes(t));
  }
  if (filters?.status) {
    filtered = filtered.filter((d) => d.status === filters.status);
  }
  return filtered;
}

export async function upsertDecision(input: Omit<Decision, "created_at" | "updated_at"> & { created_at?: string; updated_at?: string }): Promise<Decision> {
  const all = (await kv.get<Decision[]>(KV_DECISIONS)) || [];
  const now = new Date().toISOString();
  const idx = all.findIndex((d) => d.id === input.id);

  const decision: Decision = {
    ...input,
    created_at: idx >= 0 ? all[idx].created_at : (input.created_at || now),
    updated_at: now,
  };

  if (idx >= 0) {
    all[idx] = decision;
  } else {
    all.push(decision);
  }

  await kv.set(KV_DECISIONS, all);
  return decision;
}

export async function resolveDecision(
  id: string,
  decision: string,
  decided_by: string,
): Promise<Decision | null> {
  const all = (await kv.get<Decision[]>(KV_DECISIONS)) || [];
  const idx = all.findIndex((d) => d.id === id);
  if (idx < 0) return null;

  all[idx].status = "resolved";
  all[idx].decision = decision;
  all[idx].decided_by = decided_by;
  all[idx].date = new Date().toISOString().split("T")[0];
  all[idx].updated_at = new Date().toISOString();

  await kv.set(KV_DECISIONS, all);
  return all[idx];
}

// ---------------------------------------------------------------------------
// Pending Questions
// ---------------------------------------------------------------------------

export async function listPendingQuestions(
  filters?: { status?: string; asked_to?: string; topic?: string }
): Promise<PendingQuestion[]> {
  const all = (await kv.get<PendingQuestion[]>(KV_PENDING_QUESTIONS)) || [];
  let filtered = all;
  if (filters?.status) {
    filtered = filtered.filter((q) => q.status === filters.status);
  }
  if (filters?.asked_to) {
    const t = filters.asked_to.toLowerCase();
    filtered = filtered.filter((q) => q.asked_to.toLowerCase().includes(t));
  }
  if (filters?.topic) {
    const t = filters.topic.toLowerCase();
    filtered = filtered.filter((q) => q.topic.toLowerCase().includes(t));
  }
  return filtered;
}

export async function upsertPendingQuestion(
  input: PendingQuestion
): Promise<PendingQuestion> {
  const all = (await kv.get<PendingQuestion[]>(KV_PENDING_QUESTIONS)) || [];
  const idx = all.findIndex((q) => q.id === input.id);

  if (idx >= 0) {
    all[idx] = { ...all[idx], ...input };
  } else {
    all.push(input);
  }

  await kv.set(KV_PENDING_QUESTIONS, all);
  return input;
}

export async function answerQuestion(
  id: string,
  answer: string,
  answered_by: string,
): Promise<PendingQuestion | null> {
  const all = (await kv.get<PendingQuestion[]>(KV_PENDING_QUESTIONS)) || [];
  const idx = all.findIndex((q) => q.id === id);
  if (idx < 0) return null;

  all[idx].status = "answered";
  all[idx].answer = answer;
  all[idx].answered_by = answered_by;
  all[idx].answered_at = new Date().toISOString();

  await kv.set(KV_PENDING_QUESTIONS, all);
  return all[idx];
}

// ---------------------------------------------------------------------------
// COA Channel Routing Map
// ---------------------------------------------------------------------------

export async function getCoaMap(): Promise<ChannelRouting[]> {
  const map = (await kv.get<ChannelRouting[]>(KV_COA_MAP)) || [];
  return map;
}

export async function setCoaMap(routes: ChannelRouting[]): Promise<ChannelRouting[]> {
  await kv.set(KV_COA_MAP, routes);
  return routes;
}

export async function upsertChannelRouting(route: ChannelRouting): Promise<ChannelRouting[]> {
  const all = (await kv.get<ChannelRouting[]>(KV_COA_MAP)) || [];
  const idx = all.findIndex((r) => r.channel.toLowerCase() === route.channel.toLowerCase());

  if (idx >= 0) {
    all[idx] = route;
  } else {
    all.push(route);
  }

  await kv.set(KV_COA_MAP, all);
  return all;
}

// ---------------------------------------------------------------------------
// Ledger Entries (QBO queue for Rene)
// ---------------------------------------------------------------------------

export async function listEntries(
  filters?: { status?: string; type?: string; source?: string }
): Promise<LedgerEntry[]> {
  const all = (await kv.get<LedgerEntry[]>(KV_ENTRIES)) || [];
  let filtered = all;
  if (filters?.status) {
    filtered = filtered.filter((e) => e.status === filters.status);
  }
  if (filters?.type) {
    filtered = filtered.filter((e) => e.type === filters.type);
  }
  if (filters?.source) {
    filtered = filtered.filter((e) => e.source === filters.source);
  }
  return filtered;
}

export async function upsertEntry(input: LedgerEntry): Promise<LedgerEntry> {
  const all = (await kv.get<LedgerEntry[]>(KV_ENTRIES)) || [];
  const idx = all.findIndex((e) => e.id === input.id);

  if (idx >= 0) {
    all[idx] = { ...all[idx], ...input };
  } else {
    all.push(input);
  }

  await kv.set(KV_ENTRIES, all);
  return input;
}

export async function reviewEntry(
  id: string,
  status: "approved" | "rejected",
  reviewed_by: string,
): Promise<LedgerEntry | null> {
  const all = (await kv.get<LedgerEntry[]>(KV_ENTRIES)) || [];
  const idx = all.findIndex((e) => e.id === id);
  if (idx < 0) return null;

  all[idx].status = status;
  all[idx].reviewed_by = reviewed_by;
  all[idx].reviewed_at = new Date().toISOString();

  await kv.set(KV_ENTRIES, all);
  return all[idx];
}

// ---------------------------------------------------------------------------
// Notion Sync
// ---------------------------------------------------------------------------

export async function syncLedgerToNotion(): Promise<{ written: number; skipped: number; error?: string }> {
  const dbId = process.env.NOTION_DB_DECISIONS;
  if (!dbId) return { written: 0, skipped: 0, error: "NOTION_DB_DECISIONS not configured" };

  const token = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
  if (!token) return { written: 0, skipped: 0, error: "Notion token not configured" };

  const decisions = await listDecisions();
  let written = 0;
  let skipped = 0;

  for (const d of decisions) {
    try {
      // Check if decision already exists by title
      const checkRes = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify({
          filter: { property: "Name", title: { equals: d.id } },
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (checkRes.ok) {
        const checkData = (await checkRes.json()) as { results: unknown[] };
        if (checkData.results.length > 0) {
          skipped++;
          continue;
        }
      }

      await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify({
          parent: { database_id: dbId },
          properties: {
            Name: { title: [{ text: { content: d.id } }] },
            Decision: { rich_text: [{ text: { content: d.decision.slice(0, 2000) } }] },
            Topic: { select: { name: d.topic } },
            "Decided By": { rich_text: [{ text: { content: d.decided_by } }] },
            Date: { date: { start: d.date } },
            Status: { select: { name: d.status } },
            ...(d.source_thread
              ? { "Source Thread": { url: d.source_thread } }
              : {}),
            ...(d.superseded_by
              ? { "Superseded By": { rich_text: [{ text: { content: d.superseded_by } }] } }
              : {}),
            ...(d.notes
              ? { Notes: { rich_text: [{ text: { content: d.notes.slice(0, 2000) } }] } }
              : {}),
          },
        }),
        signal: AbortSignal.timeout(15000),
      });

      written++;
    } catch (err) {
      console.error(`[ledger] Notion sync failed for decision ${d.id}:`, err instanceof Error ? err.message : err);
    }
  }

  return { written, skipped };
}
