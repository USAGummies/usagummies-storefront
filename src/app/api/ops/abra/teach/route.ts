/**
 * POST /api/ops/abra/teach — Teach Abra domain knowledge
 *
 * Body: { department: string, content: string, title?: string }
 * Returns: { success: true, id: string }
 *
 * Teachings are written as high-priority brain entries that will appear
 * in future searches. Department owners can educate Abra about their domain.
 */

import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@/lib/auth/config";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { notify } from "@/lib/ops/notify";
import {
  canUseSupabase,
  markSupabaseFailure,
  markSupabaseSuccess,
} from "@/lib/ops/supabase-resilience";
import { validateRequest, TeachRequestSchema } from "@/lib/ops/validation";
import { createOperatorTasks } from "@/lib/ops/operator/task-executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 25;

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const WHOLESALE_UNIT_PRICE = 2.1;

type TriggeredOperatorTask = {
  task_type: string;
  title: string;
  description?: string;
  priority?: "critical" | "high" | "medium" | "low";
  source?: string;
  assigned_to?: string;
  requires_approval?: boolean;
  execution_params?: Record<string, unknown>;
  due_by?: string;
  tags?: string[];
};

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}) {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(15000),
  });

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!res.ok) {
    throw new Error(
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
    );
  }

  return json;
}

function isSupabaseRelatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /supabase|rest\/v1|service_role|SUPABASE/i.test(message);
}

async function buildEmbedding(text: string): Promise<number[]> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY not configured");

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Embedding failed (${res.status}): ${errText.slice(0, 200)}`,
    );
  }

  const data = await res.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error("Failed to parse embedding vector");
  }
  return embedding as number[];
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "").trim();
}

function buildNaturalKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
}

function extractAmount(text: string): number | null {
  const match = text.match(/\$\s?([\d,]+(?:\.\d{2})?)/);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function extractQuantity(text: string): number | null {
  const patterns = [
    /(\d[\d,]*)\s+units?\b/i,
    /(\d[\d,]*)\s+bags?\b/i,
    /qty(?:uantity)?[:\s]+(\d[\d,]*)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

function extractNamedParty(text: string, fallback: string): string {
  if (/inderbitzin/i.test(text)) return "Inderbitzin";
  const match = text.match(/\b(?:to|for|with)\s+([A-Z][A-Za-z0-9&.\- ]{2,60})/);
  return normalizeText(match?.[1] || fallback);
}

function extractDateIso(text: string): string {
  const match = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return match ? match[1] : new Date().toISOString().slice(0, 10);
}

function detectTeachTriggeredTasks(content: string): { tasks: TriggeredOperatorTask[]; facts: string[] } {
  const text = normalizeText(content);
  const lowered = text.toLowerCase();
  const tasks: TriggeredOperatorTask[] = [];
  const facts: string[] = [];

  const shippedOrDelivered = /\b(shipped|delivered)\b/i.test(text);
  const quantity = extractQuantity(text);
  if (shippedOrDelivered && quantity) {
    const customer = extractNamedParty(text, "customer");
    const revenue = Number((quantity * WHOLESALE_UNIT_PRICE).toFixed(2));
    facts.push(`Shipment noted for ${customer}: ${quantity} units`);
    tasks.push({
      task_type: "generate_wholesale_invoice",
      title: `Create draft wholesale invoice for ${customer} — ${quantity} units`,
      description: `Triggered from teach command: ${text.slice(0, 200)}`,
      priority: "high",
      source: "teach_trigger:shipment",
      assigned_to: "abra",
      requires_approval: true,
      execution_params: {
        natural_key: buildNaturalKey(["generate_wholesale_invoice", customer, quantity, extractDateIso(text)]),
        customer_name: customer,
        customer_id: /inderbitzin/i.test(customer) ? "20" : "",
        quantity,
        units: quantity,
        ship_date: extractDateIso(text),
        triggered_from_teach: true,
        estimated_revenue: revenue,
      },
      tags: ["finance", "invoice", "teach-trigger"],
    });
  }

  if (/\b(confirmed|scheduled)\b/i.test(text) && /\b(production|run)\b/i.test(text)) {
    const milestoneDate = extractDateIso(text);
    facts.push(`Production milestone confirmed for ${milestoneDate}`);
    tasks.push({
      task_type: "production_milestone_track",
      title: `Track production milestone — ${milestoneDate}`,
      description: text.slice(0, 300),
      priority: "medium",
      source: "teach_trigger:production",
      assigned_to: "abra",
      execution_params: {
        natural_key: buildNaturalKey(["production_milestone_track", milestoneDate, text.slice(0, 120)]),
        milestone_date: milestoneDate,
        notes: text,
      },
      tags: ["operations", "production", "teach-trigger"],
    });
  }

  const amount = extractAmount(text);
  if (amount && /\b(payment|paid|deposit)\b/i.test(text)) {
    const isIncome = /\b(received|from|customer|deposit)\b/i.test(text) && !/\bwe paid\b/i.test(lowered);
    facts.push(`Financial event captured for ${amount.toFixed(2)}`);
    tasks.push({
      task_type: "qbo_record_transaction",
      title: `${isIncome ? "Record incoming payment" : "Record payment"} ${amount.toFixed(2)}`,
      description: text.slice(0, 300),
      priority: amount > 500 ? "high" : "medium",
      source: "teach_trigger:payment",
      assigned_to: "abra",
      requires_approval: amount > 500,
      execution_params: {
        natural_key: buildNaturalKey(["qbo_record_transaction", extractDateIso(text), amount.toFixed(2), text.slice(0, 80)]),
        amount,
        date: extractDateIso(text),
        description: text,
        kind: isIncome ? "income" : "expense",
        accountCode: isIncome ? "4300" : "7200",
      },
      tags: ["finance", "teach-trigger"],
    });
  }

  if (amount && /\b(ordered|purchased)\b/i.test(text)) {
    const vendor = extractNamedParty(text, "vendor");
    const purchaseAmount = amount;
    facts.push(`Purchase event captured for ${vendor}`);
    tasks.push({
      task_type: "qbo_record_transaction",
      title: `Record purchase from ${vendor}${purchaseAmount ? ` — $${purchaseAmount.toFixed(2)}` : ""}`,
      description: text.slice(0, 300),
      priority: purchaseAmount && purchaseAmount > 500 ? "high" : "medium",
      source: "teach_trigger:purchase",
      assigned_to: "abra",
      requires_approval: Boolean(purchaseAmount && purchaseAmount > 500),
      execution_params: {
        natural_key: buildNaturalKey(["qbo_record_transaction", vendor, purchaseAmount?.toFixed(2) || "unknown", extractDateIso(text)]),
        amount: purchaseAmount || 0,
        date: extractDateIso(text),
        description: text,
        vendor,
        kind: "expense",
        accountCode: "7200",
      },
      tags: ["finance", "teach-trigger", "purchase"],
    });
  }

  return { tasks, facts };
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await auth();

  const v = await validateRequest(req, TeachRequestSchema);
  if (!v.success) return v.response;

  const department = v.data.department?.toLowerCase() || "";
  const content = v.data.content;
  const source = typeof v.data.source === "string" ? v.data.source : "";
  // Detect if this is a correction (supersedes conflicting entries)
  const isCorrection = /^correct|^correction|supersede|replaces|not.*was/i.test(content) ||
    source.includes("correction");
  const title =
    v.data.title || `${isCorrection ? "Correction" : "Teaching"}: ${department || "general"} — ${content.slice(0, 60)}`;
  const sourceRef = `teaching-${createHash("sha256")
    .update(`${department}|${title}|${content}`)
    .digest("hex")
    .slice(0, 24)}`;

  try {
    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        { error: "Brain temporarily unavailable (circuit open)" },
        { status: 503 },
      );
    }

    // Validate department exists if provided
    if (department) {
      const depts = (await sbFetch(
        `/rest/v1/abra_departments?name=eq.${encodeURIComponent(department)}&select=name`,
      )) as Array<{ name: string }>;

      if (depts.length === 0) {
        // List valid departments for the error message
        const allDepts = (await sbFetch(
          "/rest/v1/abra_departments?select=name&order=name",
        )) as Array<{ name: string }>;
        const validNames = allDepts.map((d) => d.name).join(", ");
        return NextResponse.json(
          {
            error: `Department "${department}" not found. Valid: ${validNames || "none configured"}`,
          },
          { status: 400 },
        );
      }
    }

    const taughtBy = session?.user?.email || "cron@system";
    const embeddingText = `${title}. ${content}`;
    const embedding = await buildEmbedding(embeddingText.slice(0, 8000));

    const existing = (await sbFetch(
      `/rest/v1/open_brain_entries?source_ref=eq.${encodeURIComponent(sourceRef)}&select=id&limit=1`,
    )) as Array<{ id: string }>;
    if (existing[0]?.id) {
      await markSupabaseSuccess();
      return NextResponse.json({
        success: true,
        id: existing[0].id,
        message: "Teaching already stored. Existing entry reused.",
      });
    }

    // Write to open_brain_entries as a high-priority teaching entry
    const rows = (await sbFetch("/rest/v1/open_brain_entries", {
      method: "POST",
      headers: {
        Prefer: "return=representation",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_type: "manual",
        source_ref: sourceRef,
        entry_type: "teaching",
        title,
        raw_text: `Taught by ${taughtBy}:\n${content}`,
        summary_text: content.slice(0, 500),
        category: "teaching",
        department: department || "executive",
        confidence: "high",
        priority: "important",
        processed: true,
        embedding,
      }),
    })) as Array<{ id: string }>;

    const resultId = rows[0]?.id;
    await markSupabaseSuccess();

    // Index entities from the teaching (best-effort, never blocks)
    if (resultId) {
      import("@/lib/ops/signals/entity-graph").then(({ indexEntities }) =>
        indexEntities(resultId, content).catch(() => {}),
      ).catch(() => {});
    }

    // For corrections: find and supersede conflicting entries via semantic search
    let supersededCount = 0;
    if (isCorrection && resultId && embedding.length > 0) {
      try {
        const similar = (await sbFetch("/rest/v1/rpc/search_memory", {
          method: "POST",
          body: JSON.stringify({
            query_embedding: `[${embedding.join(",")}]`,
            match_count: 5,
          }),
        })) as Array<{ id: string; title: string; similarity: number }>;

        const toSupersede = (Array.isArray(similar) ? similar : [])
          .filter((s) => s.id !== resultId); // Don't supersede self
        for (const old of toSupersede) {
          await sbFetch(
            `/rest/v1/open_brain_entries?id=eq.${encodeURIComponent(old.id)}&superseded_by=is.null`,
            {
              method: "PATCH",
              headers: { Prefer: "return=minimal" },
              body: JSON.stringify({
                superseded_by: resultId,
                superseded_at: new Date().toISOString(),
              }),
            },
          );
          supersededCount++;
        }
      } catch (err) {
        console.warn("[teach] Supersession search failed (non-fatal):", err instanceof Error ? err.message : err);
      }
    }

    const triggered = detectTeachTriggeredTasks(content);
    let createdTasks = 0;
    if (triggered.tasks.length > 0) {
      createdTasks = await createOperatorTasks(triggered.tasks).catch(() => 0);
      if (createdTasks > 0) {
        await notify({
          channel: "alerts",
          text:
            `🧠 Learned: ${triggered.facts.join(" | ")}\n` +
            `Triggered: ${triggered.tasks.map((task) => task.task_type).join(", ")}`,
        }).catch(() => {});
      }
    }

    return NextResponse.json({
      success: true,
      id: resultId,
      createdTasks,
      message: isCorrection
        ? `Correction stored. ${supersededCount > 0 ? `${supersededCount} conflicting entr${supersededCount === 1 ? "y" : "ies"} superseded.` : "No conflicting entries found to supersede."} Abra will use the corrected info going forward.`
        : `Teaching stored in ${department || "general"} knowledge. Abra will use this in future answers.${createdTasks > 0 ? ` Triggered ${createdTasks} downstream task${createdTasks === 1 ? "" : "s"}.` : ""}`,
    });
  } catch (error) {
    if (isSupabaseRelatedError(error)) {
      await markSupabaseFailure(error);
    }
    console.error("[teach] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Teaching failed" }, { status: 500 });
  }
}
