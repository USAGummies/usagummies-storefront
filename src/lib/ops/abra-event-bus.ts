/**
 * Abra Event Bus — Cross-Department Workflow Orchestration
 *
 * When an action completes in one department, related actions cascade
 * to other departments automatically. This replaces the siloed signal
 * system with actual workflow execution.
 *
 * Events are fire-and-forget: if a downstream handler fails, it logs
 * the error but never blocks the original action from completing.
 *
 * Example cascades:
 *   NEW_WHOLESALE_ORDER (Sales)
 *     → check inventory (Operations)
 *     → create AR entry (Finance)
 *     → notify Slack (Executive)
 *
 *   INVOICE_RECEIVED (Finance)
 *     → add to AP Tracker (Finance)
 *     → match to PO (Operations)
 *
 *   PRODUCTION_RUN_COMPLETE (Operations)
 *     → update inventory (Operations)
 *     → notify Sales of stock (Sales)
 *     → update COGS (Finance)
 */

import { notify } from "@/lib/ops/notify";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type AbraEventType =
  | "wholesale_order_created"
  | "invoice_received"
  | "production_run_logged"
  | "vendor_quote_recorded"
  | "transaction_recorded"
  | "vip_email_received"
  | "draft_reply_sent"
  | "draft_reply_denied"
  | "approval_approved"
  | "approval_denied"
  | "correction_logged"
  | "monthly_close_started"
  | "inventory_low"
  | "payment_overdue";

export type AbraEvent = {
  type: AbraEventType;
  department: string;
  timestamp: string;
  data: Record<string, unknown>;
  /** The action that triggered this event (for audit trail) */
  sourceAction?: string;
  sourceApprovalId?: string;
};

export type EventHandler = {
  eventType: AbraEventType;
  name: string;
  department: string;
  handler: (event: AbraEvent) => Promise<void>;
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
  if (!env) return null;

  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(10000),
  });

  if (!res.ok) return null;
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

// ---------------------------------------------------------------------------
// Event log (Supabase)
// ---------------------------------------------------------------------------

async function logEvent(event: AbraEvent): Promise<void> {
  try {
    await sbFetch("/rest/v1/abra_event_log", {
      method: "POST",
      headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: event.type,
        department: event.department,
        source_action: event.sourceAction || null,
        source_approval_id: event.sourceApprovalId || null,
        payload: event.data,
        created_at: event.timestamp,
      }),
    });
  } catch {
    // Event log is best-effort — never block the workflow
  }
}

// ---------------------------------------------------------------------------
// Cascade handlers
// ---------------------------------------------------------------------------

/** When a wholesale order is created, notify Finance + Ops */
async function onWholesaleOrderCreated(event: AbraEvent): Promise<void> {
  const { customer, amount, units, sku } = event.data as {
    customer?: string; amount?: number; units?: number; sku?: string;
  };

  // 1. Notify Slack
  await notify({
    channel: "pipeline",
    text: [
      `🛒 *New Wholesale Order*`,
      `*Customer:* ${customer || "Unknown"}`,
      amount ? `*Amount:* $${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "",
      units ? `*Units:* ${Number(units).toLocaleString()}` : "",
      sku ? `*SKU:* ${sku}` : "",
    ].filter(Boolean).join("\n"),
  }).catch(() => {});

  // 2. Create AR entry in Notion (Finance cascade)
  if (amount && customer) {
    const notionToken = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
    const arDbId = "707fad73b7cb431192a917e60a683476";
    if (notionToken) {
      try {
        await fetch(`https://api.notion.com/v1/pages`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${notionToken}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            parent: { database_id: arDbId },
            properties: {
              Name: { title: [{ text: { content: `${customer} — Wholesale Order` } }] },
              Amount: { number: amount },
              Status: { select: { name: "Pending" } },
            },
          }),
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        // AR entry is best-effort
      }
    }
  }
}

/** When an invoice is received, add to AP Tracker */
async function onInvoiceReceived(event: AbraEvent): Promise<void> {
  const { vendor, amount, invoice_number, due_date } = event.data as {
    vendor?: string; amount?: number; invoice_number?: string; due_date?: string;
  };

  // Add to AP Tracker in Notion
  const notionToken = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
  const apDbId = "c0adc90330694fcbba761fd5ce5d9802";
  if (notionToken && vendor && amount) {
    try {
      await fetch(`https://api.notion.com/v1/pages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${notionToken}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parent: { database_id: apDbId },
          properties: {
            Name: { title: [{ text: { content: `${vendor} — ${invoice_number || "Invoice"}` } }] },
            Amount: { number: amount },
            Status: { select: { name: "Unpaid" } },
            ...(due_date ? { "Due Date": { date: { start: due_date } } } : {}),
          },
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      // AP entry is best-effort
    }
  }

  // Notify finance
  await notify({
    channel: "alerts",
    text: [
      `📄 *Invoice Received*`,
      `*Vendor:* ${vendor || "Unknown"}`,
      amount ? `*Amount:* $${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "",
      invoice_number ? `*Invoice #:* ${invoice_number}` : "",
      due_date ? `*Due:* ${due_date}` : "",
    ].filter(Boolean).join("\n"),
  }).catch(() => {});
}

/** When a production run completes, notify Sales of available stock */
async function onProductionRunLogged(event: AbraEvent): Promise<void> {
  const { manufacturer, total_units_received, cost_per_unit, run_date } = event.data as {
    manufacturer?: string; total_units_received?: number; cost_per_unit?: number; run_date?: string;
  };

  await notify({
    channel: "pipeline",
    text: [
      `🏭 *Production Run Complete*`,
      `*Manufacturer:* ${manufacturer || "Unknown"}`,
      total_units_received ? `*Units Available:* ${Number(total_units_received).toLocaleString()}` : "",
      cost_per_unit ? `*Cost/Unit:* $${Number(cost_per_unit).toFixed(4)}` : "",
      run_date ? `*Date:* ${run_date}` : "",
      `\n_Sales: New inventory available for wholesale allocation._`,
    ].filter(Boolean).join("\n"),
  }).catch(() => {});
}

/** When a transaction is recorded, check for anomalies */
async function onTransactionRecorded(event: AbraEvent): Promise<void> {
  const { amount, type, vendor, description } = event.data as {
    amount?: number; type?: string; vendor?: string; description?: string;
  };

  // Flag large expenses for review
  if (type === "expense" && amount && amount > 1000) {
    await notify({
      channel: "alerts",
      text: `💰 *Large Expense Recorded*\n*Vendor:* ${vendor || "Unknown"}\n*Amount:* $${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}\n*Description:* ${(description || "").slice(0, 200)}`,
    }).catch(() => {});
  }
}

/** When a correction is logged, propagate to prevent stale data */
async function onCorrectionLogged(event: AbraEvent): Promise<void> {
  const { original_claim, correction, corrected_by } = event.data as {
    original_claim?: string; correction?: string; corrected_by?: string;
  };

  // Already notified in the correction handler, but we can do
  // additional cross-department propagation here if needed
  console.log(
    `[event-bus] Correction propagated: "${(original_claim || "").slice(0, 60)}" → "${(correction || "").slice(0, 60)}" by ${corrected_by || "unknown"}`,
  );
}

/** When a draft reply is sent, log the communication for CRM tracking */
async function onDraftReplySent(event: AbraEvent): Promise<void> {
  const { sender_email, subject, command_id } = event.data as {
    sender_email?: string; subject?: string; command_id?: string;
  };

  // Update the contact's last_contacted date in B2B prospects if they exist
  if (sender_email) {
    const notionToken = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
    const b2bDbId = process.env.NOTION_B2B_PROSPECTS_DB;
    if (notionToken && b2bDbId) {
      try {
        // Search for the contact
        const searchRes = await fetch(`https://api.notion.com/v1/databases/${b2bDbId}/query`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${notionToken}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filter: {
              property: "Email",
              email: { equals: sender_email },
            },
            page_size: 1,
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (searchRes.ok) {
          const data = await searchRes.json();
          const page = data.results?.[0];
          if (page?.id) {
            // Update last contact date
            await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${notionToken}`,
                "Notion-Version": "2022-06-28",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                properties: {
                  "Last Contact": { date: { start: new Date().toISOString().split("T")[0] } },
                },
              }),
              signal: AbortSignal.timeout(10000),
            });
          }
        }
      } catch {
        // CRM update is best-effort
      }
    }
  }

  console.log(`[event-bus] Draft reply sent: ${command_id} to ${sender_email} — Re: ${subject}`);
}

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

const EVENT_HANDLERS: EventHandler[] = [
  {
    eventType: "wholesale_order_created",
    name: "Create AR + notify",
    department: "finance",
    handler: onWholesaleOrderCreated,
  },
  {
    eventType: "invoice_received",
    name: "Add to AP Tracker",
    department: "finance",
    handler: onInvoiceReceived,
  },
  {
    eventType: "production_run_logged",
    name: "Notify Sales of stock",
    department: "sales",
    handler: onProductionRunLogged,
  },
  {
    eventType: "transaction_recorded",
    name: "Check for anomalies",
    department: "finance",
    handler: onTransactionRecorded,
  },
  {
    eventType: "correction_logged",
    name: "Propagate correction",
    department: "executive",
    handler: onCorrectionLogged,
  },
  {
    eventType: "draft_reply_sent",
    name: "Update CRM contact",
    department: "sales",
    handler: onDraftReplySent,
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Emit an event to the bus. All matching handlers run in parallel.
 * Failures are logged but never thrown — the caller always succeeds.
 */
export async function emitEvent(event: AbraEvent): Promise<{
  handlersRun: number;
  failures: number;
}> {
  // Log event to Supabase for audit trail
  void logEvent(event);

  const matching = EVENT_HANDLERS.filter((h) => h.eventType === event.type);
  if (matching.length === 0) return { handlersRun: 0, failures: 0 };

  let failures = 0;
  const results = await Promise.allSettled(
    matching.map(async (h) => {
      try {
        await h.handler(event);
      } catch (err) {
        failures++;
        console.error(
          `[event-bus] Handler "${h.name}" failed for ${event.type}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }),
  );

  return { handlersRun: results.length, failures };
}

/**
 * Get all registered event types and their handlers.
 * Useful for debugging and the admin dashboard.
 */
export function getEventRegistry(): Array<{
  eventType: AbraEventType;
  handlers: Array<{ name: string; department: string }>;
}> {
  const grouped = new Map<AbraEventType, Array<{ name: string; department: string }>>();
  for (const h of EVENT_HANDLERS) {
    const existing = grouped.get(h.eventType) || [];
    existing.push({ name: h.name, department: h.department });
    grouped.set(h.eventType, existing);
  }
  return Array.from(grouped.entries()).map(([eventType, handlers]) => ({
    eventType,
    handlers,
  }));
}
