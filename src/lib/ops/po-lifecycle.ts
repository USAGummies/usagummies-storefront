/**
 * PO Lifecycle Tracker
 *
 * Tracks purchase orders through stages:
 * quote → po_issued → deposit_paid → production → qc → shipped → received → invoiced → paid
 *
 * Each stage transition triggers a Slack notification and brain entry.
 */

import { notifyDaily } from "@/lib/ops/notify";

export type POStage = "quote" | "po_issued" | "deposit_paid" | "production" | "qc" | "shipped" | "received" | "invoiced" | "paid" | "cancelled";

export type PurchaseOrder = {
  po_number: string;
  vendor: string;
  contact: string;
  contact_email: string;
  description: string;
  total_units: number;
  unit_price: number;
  total_amount: number;
  stage: POStage;
  stage_history: Array<{ stage: POStage; date: string; note?: string }>;
  created_at: string;
  updated_at: string;
};

const STAGE_ORDER: POStage[] = ["quote", "po_issued", "deposit_paid", "production", "qc", "shipped", "received", "invoiced", "paid"];

const STAGE_EMOJI: Record<POStage, string> = {
  quote: "📝",
  po_issued: "📋",
  deposit_paid: "💰",
  production: "🏭",
  qc: "🔍",
  shipped: "🚚",
  received: "📦",
  invoiced: "🧾",
  paid: "✅",
  cancelled: "❌",
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

/**
 * Store PO state in brain entries (lightweight — no dedicated table needed).
 * Tag with "po:{po_number}" for easy lookup.
 */
export async function upsertPO(po: PurchaseOrder): Promise<boolean> {
  const env = getSupabaseEnv();
  if (!env) return false;

  const content = JSON.stringify(po);
  const title = `PO ${po.po_number} — ${po.vendor} — ${po.stage}`;

  try {
    // Check for existing PO entry
    const existing = await fetch(
      `${env.baseUrl}/rest/v1/open_brain_entries?tags=cs.{po:${encodeURIComponent(po.po_number)}}&select=id&limit=1`,
      {
        headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (existing.ok) {
      const rows = (await existing.json()) as Array<{ id: string }>;
      if (rows.length > 0) {
        // Update existing
        await fetch(`${env.baseUrl}/rest/v1/open_brain_entries?id=eq.${rows[0].id}`, {
          method: "PATCH",
          headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ title, raw_text: content, summary_text: `${po.vendor} PO #${po.po_number}: ${po.total_units} units, $${po.total_amount}, stage: ${po.stage}` }),
          signal: AbortSignal.timeout(5000),
        });
        return true;
      }
    }

    // Create new
    await fetch(`${env.baseUrl}/rest/v1/open_brain_entries`, {
      method: "POST",
      headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        source_type: "automated",
        source_ref: `po-${po.po_number}`,
        entry_type: "observation",
        title,
        raw_text: content,
        summary_text: `${po.vendor} PO #${po.po_number}: ${po.total_units} units, $${po.total_amount}, stage: ${po.stage}`,
        category: "supply_chain",
        department: "operations",
        tags: [`po:${po.po_number}`, `vendor:${po.vendor.toLowerCase()}`],
        confidence: "high",
        priority: "important",
        processed: true,
      }),
      signal: AbortSignal.timeout(5000),
    });
    return true;
  } catch { return false; }
}

export async function advancePOStage(
  poNumber: string,
  newStage: POStage,
  note?: string,
): Promise<{ ok: boolean; message: string }> {
  const emoji = STAGE_EMOJI[newStage] || "📋";
  const msg = `${emoji} *PO ${poNumber}* advanced to *${newStage}*${note ? `\n${note}` : ""}`;
  void notifyDaily(msg);
  return { ok: true, message: `PO ${poNumber} → ${newStage}` };
}

export function formatPOStatus(po: PurchaseOrder): string {
  const currentIdx = STAGE_ORDER.indexOf(po.stage);
  const progress = STAGE_ORDER.map((s, i) => {
    if (i < currentIdx) return `~~${s}~~`;
    if (i === currentIdx) return `**→ ${s.toUpperCase()}**`;
    return s;
  }).join(" → ");

  return [
    `📋 *PO #${po.po_number} — ${po.vendor}*`,
    `${po.total_units.toLocaleString()} units × $${po.unit_price}/unit = $${po.total_amount.toLocaleString()}`,
    `Contact: ${po.contact} (${po.contact_email})`,
    `Progress: ${progress}`,
  ].join("\n");
}
