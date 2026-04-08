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
// Format Templates (Rene's preferred output formats)
// ---------------------------------------------------------------------------

export interface FormatTemplate {
  id: string;
  name: string; // e.g. "pnl_format", "freight_breakdown", "order_sheet"
  description: string;
  format_spec: string; // the actual format — markdown, JSON structure, etc.
  created_by: string;
  reference_url?: string; // link to original screenshot/example
  created_at: string;
  updated_at: string;
}

const KV_TEMPLATES = "ledger:templates";

export async function listTemplates(): Promise<FormatTemplate[]> {
  return (await kv.get<FormatTemplate[]>(KV_TEMPLATES)) || [];
}

export async function getTemplate(name: string): Promise<FormatTemplate | null> {
  const all = (await kv.get<FormatTemplate[]>(KV_TEMPLATES)) || [];
  return all.find((t) => t.name.toLowerCase() === name.toLowerCase()) || null;
}

export async function upsertTemplate(
  input: Omit<FormatTemplate, "created_at" | "updated_at"> & { created_at?: string; updated_at?: string }
): Promise<FormatTemplate> {
  const all = (await kv.get<FormatTemplate[]>(KV_TEMPLATES)) || [];
  const now = new Date().toISOString();
  const idx = all.findIndex((t) => t.id === input.id || t.name.toLowerCase() === input.name.toLowerCase());

  const template: FormatTemplate = {
    ...input,
    created_at: idx >= 0 ? all[idx].created_at : (input.created_at || now),
    updated_at: now,
  };

  if (idx >= 0) {
    all[idx] = template;
  } else {
    all.push(template);
  }

  await kv.set(KV_TEMPLATES, all);
  return template;
}

// ---------------------------------------------------------------------------
// Entry History / Versioning
// ---------------------------------------------------------------------------

export interface EntryVersion {
  entry_id: string;
  version: number;
  snapshot: LedgerEntry;
  changed_by: string;
  change_reason?: string;
  timestamp: string;
}

const KV_ENTRY_HISTORY = "ledger:entry_history";

export async function getEntryHistory(entryId: string): Promise<EntryVersion[]> {
  const all = (await kv.get<EntryVersion[]>(KV_ENTRY_HISTORY)) || [];
  return all.filter((v) => v.entry_id === entryId).sort((a, b) => a.version - b.version);
}

export async function recordEntryVersion(
  entry: LedgerEntry,
  changed_by: string,
  change_reason?: string,
): Promise<EntryVersion> {
  const all = (await kv.get<EntryVersion[]>(KV_ENTRY_HISTORY)) || [];

  // Find the next version number for this entry
  const existing = all.filter((v) => v.entry_id === entry.id);
  const nextVersion = existing.length > 0 ? Math.max(...existing.map((v) => v.version)) + 1 : 1;

  const version: EntryVersion = {
    entry_id: entry.id,
    version: nextVersion,
    snapshot: { ...entry },
    changed_by,
    change_reason,
    timestamp: new Date().toISOString(),
  };

  all.push(version);
  if (all.length > 2000) all.splice(0, all.length - 2000);
  await kv.set(KV_ENTRY_HISTORY, all);

  return version;
}

// ---------------------------------------------------------------------------
// Reconciler (QBO vs Bank diff)
// ---------------------------------------------------------------------------

export interface ReconciliationResult {
  id: string;
  date: string;
  period_start: string;
  period_end: string;
  bank_balance?: number;
  qbo_balance?: number;
  difference?: number;
  unmatched_bank: Array<{ date: string; description: string; amount: number }>;
  unmatched_qbo: Array<{ date: string; description: string; amount: number }>;
  status: "clean" | "discrepancies_found" | "error";
  error_message?: string;
  run_at: string;
}

const KV_RECONCILIATIONS = "ledger:reconciliations";

export async function runReconciliation(): Promise<ReconciliationResult> {
  const now = new Date();
  const id = `recon-${now.toISOString().split("T")[0]}`;
  const periodEnd = now.toISOString().split("T")[0];
  const periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const result: ReconciliationResult = {
    id,
    date: periodEnd,
    period_start: periodStart,
    period_end: periodEnd,
    unmatched_bank: [],
    unmatched_qbo: [],
    status: "clean",
    run_at: now.toISOString(),
  };

  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    result.status = "error";
    result.error_message = "CRON_SECRET not configured";
    return result;
  }

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXTAUTH_URL || "http://localhost:3000";

  const headers = {
    Authorization: `Bearer ${cronSecret}`,
    "Content-Type": "application/json",
  };

  try {
    // Fetch bank balance from Plaid
    const [bankRes, qboRes] = await Promise.all([
      fetch(`${baseUrl}/api/ops/plaid/balance`, { headers, signal: AbortSignal.timeout(30000) }),
      fetch(`${baseUrl}/api/ops/qbo/query?type=pnl&start=${periodStart}&end=${periodEnd}`, {
        headers, signal: AbortSignal.timeout(30000),
      }),
    ]);

    if (bankRes.ok) {
      const bankData = (await bankRes.json()) as { accounts?: Array<{ current?: number; name?: string }> };
      const checking = bankData.accounts?.find((a) => a.name?.toLowerCase().includes("checking"));
      if (checking) result.bank_balance = checking.current;
    }

    if (qboRes.ok) {
      const qboData = (await qboRes.json()) as { netIncome?: number; totalRevenue?: number; totalExpenses?: number };
      result.qbo_balance = qboData.netIncome;
    }

    if (result.bank_balance !== undefined && result.qbo_balance !== undefined) {
      result.difference = Math.round((result.bank_balance - result.qbo_balance) * 100) / 100;
      result.status = Math.abs(result.difference) < 1 ? "clean" : "discrepancies_found";
    }
  } catch (err) {
    result.status = "error";
    result.error_message = err instanceof Error ? err.message : String(err);
  }

  // Persist
  const history = (await kv.get<ReconciliationResult[]>(KV_RECONCILIATIONS)) || [];
  history.push(result);
  if (history.length > 90) history.splice(0, history.length - 90);
  await kv.set(KV_RECONCILIATIONS, history);

  return result;
}

export async function getReconciliationHistory(limit = 30): Promise<ReconciliationResult[]> {
  const all = (await kv.get<ReconciliationResult[]>(KV_RECONCILIATIONS)) || [];
  return all.slice(-limit);
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
