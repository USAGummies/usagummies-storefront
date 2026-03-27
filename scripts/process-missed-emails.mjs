#!/usr/bin/env node

import path from "node:path";

if (typeof process.loadEnvFile === "function") {
  process.loadEnvFile(".env.local");
}

const MISSED_EMAIL_IDS = [
  "19d2bdd17ce6e6b5",
  "19d2ae4063ef9b59",
  "19d2ac1c2c948166",
  "19d2bd9b79b93559",
  "19d2bda6c5131896",
  "19d2bdbe2fe4ea47",
  "19d2b3328c58d529",
  "19d2653e76d9d5ed",
  "19d2518dad006ce7",
  "19d2b593e16060d8",
  "19d2c18dc68b6e4a",
  "19d2393641e5f850",
  "19d2bd855d791167",
];

const forceSummary = process.argv.includes("--force-summary");
const reprocess = process.argv.includes("--reprocess");

const emailIntelligenceMod = await import(path.resolve("src/lib/ops/operator/email-intelligence.ts"));

const result = await emailIntelligenceMod.runEmailIntelligence({
  messageIds: MISSED_EMAIL_IDS,
  includeRecent: false,
  forceSummary,
  reprocess,
});

async function persistTasks(tasks) {
  if (!Array.isArray(tasks) || !tasks.length) return 0;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  const recentRes = await fetch(
    `${url}/rest/v1/abra_operator_tasks?select=id,status,created_at,completed_at,retry_count,max_retries,execution_params&created_at=gte.${encodeURIComponent(
      new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    )}&limit=1000`,
    { headers },
  );
  const recent = recentRes.ok ? await recentRes.json() : [];
  const normalize = (value) => String(value || "").trim().toLowerCase();
  const inserts = tasks.filter((task) => {
    const naturalKey = normalize(task.execution_params?.natural_key);
    if (!naturalKey) return true;
    return !recent.some((row) => normalize(row.execution_params?.natural_key) === naturalKey);
  });
  if (!inserts.length) return 0;

  const payload = inserts.map((task) => ({
    task_type: task.task_type,
    title: task.title,
    description: task.description || null,
    priority: task.priority || "medium",
    status: (task.requires_approval && !["email_draft_response", "vendor_response_needed", "generate_wholesale_invoice", "inventory_reorder_po", "vendor_followup", "distributor_followup"].includes(task.task_type))
      ? "needs_approval"
      : "pending",
    source: task.source || "email_intelligence",
    assigned_to: task.assigned_to || "abra",
    requires_approval: task.requires_approval ?? false,
    execution_params: task.execution_params || {},
    due_by: task.due_by || null,
    tags: task.tags || [],
  }));

  const insertRes = await fetch(`${url}/rest/v1/abra_operator_tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!insertRes.ok) {
    throw new Error(`Task insert failed (${insertRes.status}): ${await insertRes.text()}`);
  }
  return inserts.length;
}

const createdTasks = await persistTasks(result.tasks);

console.log(
  JSON.stringify(
    {
      processed: result.summary.processed,
      actionsTaken: result.summary.actionsTaken,
      needsAttention: result.summary.needsAttention,
      createdTasks,
      postedSummary: result.postedSummary,
      details: result.summary.details,
    },
    null,
    2,
  ),
);
