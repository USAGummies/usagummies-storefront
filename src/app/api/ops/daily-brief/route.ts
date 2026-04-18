/**
 * Daily brief endpoint.
 *
 * Blueprint §15.4 W3a. Called by a Make.com scenario (or any scheduler)
 * twice a day: 7 AM PT (morning) and 6 PM PT (end-of-day). Posts the
 * composed brief to #ops-daily via the control-plane Slack client and
 * returns the rendered brief JSON.
 *
 * Auth: bearer CRON_SECRET.
 * Scheduler: Ben wires Make.com separately per /ops/blocked-items.md.
 *
 * Scope — day-one: control-plane state is authoritative; external
 * revenue/cash integrations are NOT wired by this route yet. When those
 * integrations are added (separate commit), they pass their data into
 * composeDailyBrief via BriefInput.revenueYesterday and cashPosition.
 * Until then, the brief renders "unavailable" lines for those fields
 * rather than fabricating numbers.
 */

import { NextResponse } from "next/server";

import { composeDailyBrief, type BriefKind } from "@/lib/ops/control-plane/daily-brief";
import { listDivisions } from "@/lib/ops/control-plane/divisions";
import { getChannel } from "@/lib/ops/control-plane/channels";
import {
  approvalStore,
  auditStore,
  pauseSink,
} from "@/lib/ops/control-plane/stores";
import { postMessage } from "@/lib/ops/control-plane/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : header.trim();
  if (!supplied) return false;
  if (supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < supplied.length; i++) {
    diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const kindParam = url.searchParams.get("kind");
  const kind: BriefKind = kindParam === "eod" ? "eod" : "morning";
  const postToSlack = url.searchParams.get("post") !== "false";

  const now = new Date();
  const degradations: string[] = [];

  // ---- Gather control-plane state ----
  let pendingApprovals: Awaited<ReturnType<ReturnType<typeof approvalStore>["listPending"]>> = [];
  try {
    pendingApprovals = await approvalStore().listPending();
  } catch (err) {
    degradations.push(
      `approval store unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let pausedAgents: Awaited<ReturnType<ReturnType<typeof pauseSink>["listPaused"]>> = [];
  try {
    pausedAgents = await pauseSink().listPaused();
  } catch (err) {
    degradations.push(
      `pause sink unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let recentAudit: Awaited<ReturnType<ReturnType<typeof auditStore>["recent"]>> = [];
  try {
    recentAudit = await auditStore().recent(500);
  } catch (err) {
    degradations.push(
      `audit store unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const lastDriftAuditSummary = findLastDriftAuditSummary(recentAudit);

  // ---- Divisions ----
  const activeDivisions = listDivisions("active").map((d) => ({
    id: d.id,
    name: d.name,
    humanOwner: d.humanOwner,
  }));

  const brief = composeDailyBrief({
    kind,
    asOf: now,
    activeDivisions,
    pendingApprovals,
    pausedAgents,
    recentAudit,
    lastDriftAuditSummary,
    // External revenue / cash joins are TODO — intentionally omitted so
    // the composer renders explicit "unavailable" lines.
    degradations,
  });

  // ---- Post to Slack ----
  let postResult: { ok: boolean; ts?: string; error?: string } | null = null;
  if (postToSlack) {
    const channel = getChannel("ops-daily")?.name ?? "#ops-daily";
    const res = await postMessage({ channel, text: brief.text, blocks: brief.blocks });
    postResult = { ok: res.ok, ts: res.ts, error: res.error };
  }

  return NextResponse.json({
    ok: true,
    degraded: brief.meta.degraded,
    brief: {
      meta: brief.meta,
      text: brief.text,
      blocks: brief.blocks,
    },
    post: postResult,
  });
}

function findLastDriftAuditSummary(entries: readonly { action: string; after?: unknown }[]): string | undefined {
  // auditStore.recent returns newest-first.
  const hit = entries.find((e) => e.action === "drift-audit.scorecard");
  if (!hit) return undefined;
  return typeof hit.after === "string" ? hit.after : undefined;
}
