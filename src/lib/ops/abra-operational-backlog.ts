/**
 * abra-operational-backlog.ts — Abra's self-managed work queue
 *
 * This module gives Abra awareness of what it needs to accomplish for the
 * business. Instead of waiting for questions, Abra can proactively track
 * and execute tasks from this backlog.
 *
 * Storage: Supabase `open_brain_entries` table with category="backlog"
 * and structured JSON in raw_text.
 *
 * Each backlog item has:
 *   - title: what needs to be done
 *   - status: pending | in_progress | completed | blocked
 *   - priority: critical | high | medium | low
 *   - department: finance | operations | sales | supply_chain
 *   - owner: abra | ben | rene
 *   - due_date: optional ISO date
 *   - depends_on: optional list of prerequisite task IDs
 *   - outcome: what was accomplished (filled when completed)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BacklogStatus = "pending" | "in_progress" | "completed" | "blocked";
export type BacklogPriority = "critical" | "high" | "medium" | "low";
export type BacklogOwner = "abra" | "ben" | "rene";

export type BacklogItem = {
  id: string;
  title: string;
  description: string;
  status: BacklogStatus;
  priority: BacklogPriority;
  department: string;
  owner: BacklogOwner;
  due_date: string | null;
  depends_on: string[];
  outcome: string | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase not configured");

  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(12000),
  });

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try { json = JSON.parse(text); } catch { json = text; }
  }
  if (!res.ok) {
    throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 300)}`);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Backlog item serialization (stored as JSON in brain entry raw_text)
// ---------------------------------------------------------------------------

type StoredBacklogData = {
  type: "backlog_item";
  status: BacklogStatus;
  priority: BacklogPriority;
  department: string;
  owner: BacklogOwner;
  due_date: string | null;
  depends_on: string[];
  outcome: string | null;
  description: string;
};

function parseBacklogEntry(row: {
  id: string;
  title: string;
  raw_text: string;
  created_at: string;
}): BacklogItem | null {
  try {
    const data = JSON.parse(row.raw_text) as StoredBacklogData;
    if (data.type !== "backlog_item") return null;
    return {
      id: row.id,
      title: row.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      department: data.department,
      owner: data.owner,
      due_date: data.due_date,
      depends_on: data.depends_on || [],
      outcome: data.outcome,
      created_at: row.created_at,
      updated_at: row.created_at, // brain entries don't have updated_at; use created_at
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get all active backlog items (pending, in_progress, blocked).
 * Sorted by priority (critical first) then created_at.
 */
export async function getActiveBacklog(): Promise<BacklogItem[]> {
  try {
    const rows = (await sbFetch(
      `/rest/v1/open_brain_entries?category=eq.backlog&superseded_at=is.null&select=id,title,raw_text,created_at&order=created_at.desc&limit=100`,
    )) as Array<{ id: string; title: string; raw_text: string; created_at: string }>;

    const items = rows
      .map(parseBacklogEntry)
      .filter((item): item is BacklogItem => item !== null && item.status !== "completed");

    // Sort: critical > high > medium > low, then by created_at
    const priorityRank: Record<BacklogPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    items.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.created_at.localeCompare(b.created_at));

    return items;
  } catch (err) {
    console.error("[abra-backlog] getActiveBacklog failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Get backlog items filtered by owner.
 */
export async function getBacklogForOwner(owner: BacklogOwner): Promise<BacklogItem[]> {
  const all = await getActiveBacklog();
  return all.filter((item) => item.owner === owner);
}

/**
 * Create a new backlog item.
 */
export async function createBacklogItem(item: {
  title: string;
  description: string;
  priority: BacklogPriority;
  department: string;
  owner: BacklogOwner;
  due_date?: string;
  depends_on?: string[];
}): Promise<string> {
  const data: StoredBacklogData = {
    type: "backlog_item",
    status: "pending",
    priority: item.priority,
    department: item.department,
    owner: item.owner,
    due_date: item.due_date || null,
    depends_on: item.depends_on || [],
    outcome: null,
    description: item.description,
  };

  const rows = (await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    headers: { Prefer: "return=representation", "Content-Type": "application/json" },
    body: JSON.stringify({
      source_type: "system",
      source_ref: `backlog:${Date.now()}`,
      entry_type: "decision",
      title: item.title,
      raw_text: JSON.stringify(data),
      summary_text: `[BACKLOG] ${item.priority.toUpperCase()} | ${item.owner} | ${item.title}`,
      category: "backlog",
      department: item.department,
      confidence: "high",
      priority: item.priority === "critical" ? "urgent" : "normal",
      processed: true,
      tags: ["backlog", `owner:${item.owner}`, `dept:${item.department}`, item.priority],
      created_at: new Date().toISOString(),
    }),
  })) as Array<{ id: string }>;

  return rows[0]?.id || "";
}

/**
 * Update the status of a backlog item. When completing, provide an outcome.
 */
export async function updateBacklogStatus(
  itemId: string,
  status: BacklogStatus,
  outcome?: string,
): Promise<void> {
  // Read current entry
  const rows = (await sbFetch(
    `/rest/v1/open_brain_entries?id=eq.${itemId}&select=id,raw_text`,
  )) as Array<{ id: string; raw_text: string }>;

  if (!rows[0]) throw new Error(`Backlog item ${itemId} not found`);

  const data = JSON.parse(rows[0].raw_text) as StoredBacklogData;
  data.status = status;
  if (outcome) data.outcome = outcome;

  // If completed, supersede the entry (soft-delete from active list)
  const updatePayload: Record<string, unknown> = {
    raw_text: JSON.stringify(data),
  };
  if (status === "completed") {
    updatePayload.superseded_at = new Date().toISOString();
  }

  await sbFetch(`/rest/v1/open_brain_entries?id=eq.${itemId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
    body: JSON.stringify(updatePayload),
  });
}

/**
 * Build a context string for the LLM prompt showing what Abra needs to work on.
 * This gets injected into the system prompt so Abra is aware of its priorities.
 */
export async function getBacklogContext(): Promise<string | null> {
  try {
    const items = await getActiveBacklog();
    if (items.length === 0) return null;

    const lines: string[] = [];
    lines.push("=== ABRA OPERATIONAL BACKLOG ===");
    lines.push(`${items.length} active tasks requiring attention:\n`);

    for (const item of items.slice(0, 15)) {
      const statusIcon = item.status === "blocked" ? "🚫" : item.status === "in_progress" ? "🔄" : "📋";
      const priorityTag = item.priority === "critical" ? "🔴" : item.priority === "high" ? "🟠" : "⚪";
      const dueStr = item.due_date ? ` (due: ${item.due_date})` : "";
      lines.push(`${statusIcon} ${priorityTag} [${item.owner.toUpperCase()}] ${item.title}${dueStr}`);
      if (item.description) lines.push(`   ${item.description.slice(0, 150)}`);
      if (item.status === "blocked" && item.depends_on.length > 0) {
        lines.push(`   Blocked by: ${item.depends_on.join(", ")}`);
      }
    }

    if (items.length > 15) {
      lines.push(`\n... and ${items.length - 15} more tasks`);
    }

    lines.push("\nWhen appropriate, proactively work on or reference these tasks.");
    lines.push("=== END BACKLOG ===");

    return lines.join("\n");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Seed: Initial operational backlog for USA Gummies
// ---------------------------------------------------------------------------

/**
 * Seeds the initial operational backlog. Call once to populate.
 * Idempotent — checks if backlog items already exist before creating.
 */
export async function seedOperationalBacklog(): Promise<{ created: number; skipped: number }> {
  const existing = await getActiveBacklog();
  if (existing.length > 0) {
    return { created: 0, skipped: existing.length };
  }

  const items: Array<Parameters<typeof createBacklogItem>[0]> = [
    // CRITICAL — Blocking all financial operations
    {
      title: "Authenticate QBO OAuth — connect QuickBooks to Abra",
      description: "Visit /api/ops/qbo/authorize to connect QBO. Without this, all financial queries return empty data. Rene or Ben must complete the OAuth flow in a browser.",
      priority: "critical",
      department: "finance",
      owner: "ben",
    },
    {
      title: "Categorize QBO bank feed transactions",
      description: "Once QBO is connected, batch-categorize all uncategorized bank feed transactions using the auto-categorization rules. Rene investor transfers → liability account 167. Abra can handle this with batch_categorize_qbo action.",
      priority: "critical",
      department: "finance",
      owner: "abra",
    },

    // HIGH — Business operations
    {
      title: "Store paid invoice data as verified COGS facts",
      description: "Ben mentioned two invoices are now paid and represent solid COGS numbers. When Ben provides invoice details (vendor, amount, units, date), store as brain_verified entries and update COGS calculations.",
      priority: "high",
      department: "finance",
      owner: "abra",
    },
    {
      title: "Set up QBO vendor records",
      description: "Create vendor records in QBO for: Powers Confections (co-packer), Albanese Confectionery (ingredients), NinjaPrintHouse (packaging), Pirate Ship (shipping). Abra knows the vendors from brain memory.",
      priority: "high",
      department: "finance",
      owner: "abra",
    },
    {
      title: "Reconcile bank feeds with actual bank statements",
      description: "After QBO is connected and transactions categorized, run reconciliation to match bank feed entries with actual bank statement. Use reconcile_transactions action.",
      priority: "high",
      department: "finance",
      owner: "rene",
    },
    {
      title: "Powers Confections 50K unit production run — track invoices and deposits",
      description: "Active production run planning with Powers Confections (Bill Turley). Track all quotes, invoices, deposits, and payments. When invoices are paid, update COGS per unit calculation. Current rate quoted: $0.35/bag tolling.",
      priority: "high",
      department: "supply_chain",
      owner: "abra",
    },
    {
      title: "Update Supabase product_config COGS from $1.35 to $3.11",
      description: "The product_config table has $1.35/unit (ingredient-only). The actual verified COGS is $3.11/unit (all-in from Dutch Valley Run #1). This needs to be corrected to prevent wrong margin calculations.",
      priority: "high",
      department: "finance",
      owner: "abra",
    },

    // MEDIUM — Ongoing operations
    {
      title: "Set up QBO chart of accounts for C-Corp (Form 1120)",
      description: "Map the chart of accounts to C-Corp structure. Standard categories from Found Banking to QBO: Revenue by channel (DTC/Amazon/Wholesale), COGS (5100-5400 series), Operating Expenses by type.",
      priority: "medium",
      department: "finance",
      owner: "rene",
    },
    {
      title: "Configure revenue accounts by channel in QBO",
      description: "Set up separate revenue tracking: DTC (Shopify), Amazon marketplace, Wholesale. Each channel has different margin profiles.",
      priority: "medium",
      department: "finance",
      owner: "rene",
    },
    {
      title: "Run first monthly close (March 2026)",
      description: "Execute end-of-month close process. Requires: QBO connected, transactions categorized, bank reconciled. Use run_monthly_close action.",
      priority: "medium",
      department: "finance",
      owner: "abra",
      due_date: "2026-03-31",
    },
    {
      title: "Inventory count verification — current units on hand",
      description: "Verify actual inventory count from Sept 2025 run (2,500 units produced). Subtract all shipped orders. Update Shopify inventory levels to match physical count.",
      priority: "medium",
      department: "supply_chain",
      owner: "ben",
    },
  ];

  let created = 0;
  for (const item of items) {
    try {
      await createBacklogItem(item);
      created++;
    } catch (err) {
      console.error(`[abra-backlog] Failed to create: ${item.title}`, err instanceof Error ? err.message : err);
    }
  }

  return { created, skipped: 0 };
}
