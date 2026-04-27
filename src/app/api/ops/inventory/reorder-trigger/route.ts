/**
 * POST /api/ops/inventory/reorder-trigger
 *
 * Phase 30.2 — fires the reorder watch alert to `#operations` for
 * any SKU whose cover-days dropped below threshold (urgent ≤ 14d
 * or soon ≤ 30d).
 *
 * Hard rules:
 *   - **Auth-gated.** `isAuthorized()` (session OR CRON_SECRET).
 *   - **Class A surface.** Posts to `#operations` only. Does NOT
 *     auto-create `qbo.po.draft` Class B approvals — the human
 *     opens the proposal deliberately. (Approval spam is the
 *     anti-pattern; surfacing visibility is the goal.)
 *   - **Idempotent per SKU per day.** KV dedup at
 *     `inventory-reorder:alert:<sku>:<YYYY-MM-DD>`. A 09:00 cron +
 *     14:00 cron in the same day fire AT MOST one alert per
 *     low-cover SKU.
 *   - **Fail-soft.** KV outage → fresh-set treated as ALL-fresh
 *     (better to alert twice than to silently swallow). Slack
 *     post failure → recorded in response, never throws.
 *   - **Read-only on inventory.** Only reads the snapshot/forecast;
 *     does not modify Shopify inventory levels.
 *
 * Response (200):
 *   {
 *     ok: true,
 *     generatedAt: ISO,
 *     candidatesTotal: number,        // before dedup
 *     posted: number,                  // newly alerted today
 *     alreadyAlertedToday: number,
 *     slackOk: boolean,
 *     message?: string                 // verbatim Slack body (audit)
 *   }
 */
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { postMessage } from "@/lib/ops/control-plane/slack/client";
import { forecastCoverDays } from "@/lib/ops/inventory-forecast";
import {
  KV_INVENTORY_SNAPSHOT,
  type InventorySnapshot,
} from "@/lib/ops/inventory-snapshot";
import {
  partitionAlreadyAlerted,
  pickReorderCandidates,
  renderReorderSlackMessage,
  type ReorderCandidate,
} from "@/lib/ops/inventory-reorder-trigger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KV_TTL_HOURS = 36; // covers a same-day re-fire even at 23:59 + DST shenanigans

async function loadAlertedSet(
  candidates: readonly ReorderCandidate[],
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  // Read each dedup key. KV throw → empty set (fail-soft toward
  // alerting; fewer false negatives is better than silently
  // missing a stockout warning).
  const checks = await Promise.allSettled(
    candidates.map(async (c) => {
      const v = await kv.get<string>(c.dedupKey);
      return v ? c.dedupKey : null;
    }),
  );
  const set = new Set<string>();
  for (const r of checks) {
    if (r.status === "fulfilled" && r.value) set.add(r.value);
  }
  return set;
}

async function persistAlertedKeys(
  fired: readonly ReorderCandidate[],
): Promise<void> {
  // Best-effort. A KV write failure here only means the next scan
  // re-alerts — annoying, never destructive.
  await Promise.allSettled(
    fired.map((c) =>
      kv.set(c.dedupKey, "1", { ex: KV_TTL_HOURS * 3600 }),
    ),
  );
}

async function readSnapshotSafe(): Promise<InventorySnapshot | null> {
  try {
    return ((await kv.get<InventorySnapshot>(KV_INVENTORY_SNAPSHOT)) ??
      null) as InventorySnapshot | null;
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const generatedAt = new Date().toISOString();

  // 1) Build the forecast.
  const snapshot = await readSnapshotSafe();
  const forecast = forecastCoverDays(snapshot);

  // 2) Pick + dedup candidates.
  const candidates = pickReorderCandidates(forecast);
  const alertedSet = await loadAlertedSet(candidates);
  const { fresh, alreadyAlerted } = partitionAlreadyAlerted(
    candidates,
    (key) => alertedSet.has(key),
  );

  // 3) Render the Slack message.
  const message = renderReorderSlackMessage(fresh, forecast);

  // 4) Post (only when there's something to say) + persist dedup keys.
  let slackOk = true;
  if (fresh.length > 0 && message) {
    const result = await postMessage({
      channel: "#operations",
      text: message,
    });
    slackOk = result.ok;
    if (slackOk) {
      await persistAlertedKeys(fresh);
    }
  }

  // 5) Audit envelope (Class A `slack.post.audit`-flavored).
  try {
    const run = newRunContext({
      agentId: "inventory-reorder-trigger",
      division: "production-supply-chain",
      source: "scheduled",
      trigger: "inventory-reorder-trigger",
    });
    const entry = buildAuditEntry(run, {
      action: "slack.post.audit",
      entityType: "slack-channel",
      entityId: "operations",
      after: {
        candidatesTotal: candidates.length,
        posted: fresh.length,
        skipped: alreadyAlerted.length,
        slackOk,
        urgentSkus: fresh.filter((c) => c.urgency === "urgent").map((c) => c.sku),
      },
      result: slackOk ? "ok" : "error",
      sourceCitations: [{ system: "shopify-admin", id: "inventory-snapshot" }],
      confidence: 1,
    });
    await auditStore().append(entry);
  } catch {
    // Audit-store failure is non-fatal observability gap.
  }

  return NextResponse.json({
    ok: true,
    generatedAt,
    candidatesTotal: candidates.length,
    posted: fresh.length,
    alreadyAlertedToday: alreadyAlerted.length,
    slackOk,
    message: message || undefined,
  });
}
